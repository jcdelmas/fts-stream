import { Queue } from './queue'
import { Sink, Stream } from './stream'

export function broadcast<A>(): [Sink<A, void>, Stream<A>] {
  const subscribers: Queue<A>[] = []

  const stream = Stream.fromAsyncIterator<A>(async function*() {
    const queue = Queue.bounded<A>(0)
    try {
      subscribers.push(queue)
      yield* queue
    } finally {
      queue.close()
      subscribers.splice(subscribers.indexOf(queue), 1)
    }
  })

  const sink = async (source: Stream<A>) => {
    try {
      await Promise.all(subscribers.map(s => s.onAvailable()))
      for await (const a of source) {
        await Promise.all(subscribers.map(s => s.offerIfNotClosed(a)))
        if (subscribers.length === 0) break
        await Promise.all(subscribers.map(s => s.onAvailable()))
      }
    } finally {
      subscribers.map(s => s.close())
    }
  }

  return [sink, stream]
}
