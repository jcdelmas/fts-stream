import { Pipe, Stream, Take } from './stream'
import { bracket, promiseChannel } from './promises'
import { Chunk } from './chunk'
import { Interrupted, Queue } from './queue'

interface Subscriber<A> {
  next(a: A): Promise<boolean>
  complete(): void
  fail(err: any): void
}

export function balance<A>(): Pipe<A, Stream<A>> {
  return stream => Stream.lazy(() => {
    let subscriberCount: number = 0
    const subscribers: Queue<Take<Subscriber<Chunk<A>>>> = Queue.unbounded(remaining => {
      remaining.forEach(take => take.fold(
        sub => sub.complete(),
        () => {},
        err => console.error(err)
      ))
    })

    const substream = Stream.create<A>(async push => {
      const subscriberTermination = promiseChannel<boolean>()
      const subscriber = new class {
        async next(chunk: Chunk<A>) {
          const cont = await push(chunk)
          if (!cont) {
            subscriberTermination.resolve(false)
          }
          return cont
        }

        complete() {
          subscriberTermination.resolve(true)
        }

        fail(err: any) {
          subscriberTermination.reject(err)
        }
      }
      subscriberCount++
      await subscribers.offer(Take.value(subscriber))
      return subscriberTermination.promise
    })

    return Stream.repeat(substream).onTerminate(() => {
      return bracket(
        () => stream.foreachChunks(async chunk => {
          const take = await subscribers.take()
          take.fold(
            sub => {
              sub.next(chunk)
                .then(
                  async cont => {
                    if (cont && !subscribers.isClosed) {
                      await subscribers.offer(Take.value(sub))
                    } else {
                      sub.complete()
                      subscriberCount--
                      if (subscriberCount === 0) {
                        await subscribers.offerIfNotClosed(Take.done())
                      }
                    }
                  }
                )
                .catch(err => subscribers.offer(Take.fail(err)))
            },
            () => {},
            err => { throw err }
          )
          return subscriberCount > 0
        }).then(() => {}),
        () => subscribers.close()
      )
    })
  })
}
