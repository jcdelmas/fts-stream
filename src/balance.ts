import { Queue } from './queue'
import { Sink, Stream } from './stream'

export function balance<A>(): [Sink<A, void>, Stream<A>] {
  let subscriberCount: number = 0
  const queue = Queue.bounded<A>(0)

  const stream = Stream.fromAsyncIterator<A>(async function*() {
    subscriberCount++
    try {
      for await (const a of queue) {
        yield a
      }
    } finally {
      subscriberCount--
      if (subscriberCount === 0) queue.close()
    }
  })

  const sink = async (source: Stream<A>) => {
    try {
      for await (const a of source) {
        await queue.offerIfNotClosed(a)
        if (queue.isClosed) break
      }
    } finally {
      queue.close()
    }
  }

  return [sink, stream]
}
