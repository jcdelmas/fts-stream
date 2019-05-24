import { Chunk } from './chunk'
import { bracket, promiseChannel } from './promises'
import { Pipe, Stream } from './stream'

interface Subscriber<A> {
  next(a: A): Promise<void>
  complete(): void
  fail(err: any): void
}

export function broadcast<A>(): Pipe<A, Stream<A>> {
  return stream => Stream.lazy(() => {
    const subscribers: Subscriber<Chunk<A>>[] = []

    const substream = Stream.createChunked<A>(push => {
      const subscriberTermination = promiseChannel<boolean>()
      const subscriber = new class {
        async next(chunk: Chunk<A>) {
          const cont = await push(chunk)
          if (!cont) {
            subscribers.splice(subscribers.indexOf(this), 1)
            subscriberTermination.resolve(false)
          }
        }

        complete() {
          subscriberTermination.resolve(true)
        }

        fail(err: any) {
          subscriberTermination.reject(err)
        }
      }
      subscribers.push(subscriber)
      return subscriberTermination.promise
    })

    return Stream.repeat(substream).onTerminate(() => {
      return bracket(
        () => stream.foreachChunks(async chunk => {
          await Promise.all(subscribers.map(sub => sub.next(chunk)))
          return subscribers.length > 0
        }).then(() => {}),
        () => subscribers.forEach(sub => sub.complete()),
      )
    })
  })
}
