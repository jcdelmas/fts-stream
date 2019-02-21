import { balance } from './balance'
import { broadcast } from './broadcast'
import { Chunk } from './chunk'
import { Consumer } from './consumer'
import { Managed, ManagedImpl } from './managed'
import { bracket, promiseChannel } from './promises'
import { OverflowStrategy, Queue, QueueReader, QueueWriter } from './queue'
import { Semaphore } from './semaphore'
import { P } from './helpers';

export type Pipe<I, O> = (s: Stream<I>) => Stream<O>
export type Sink<I, O> = (s: Stream<I>) => Promise<O>

export abstract class Stream<A> {

  abstract foreachChunks(push: (as: Chunk<A>) => P<boolean>): Promise<boolean>

  foreach(push: (a: A) => void): Promise<void> {
    return this.foreachChunks(chunk => {
      for (const x of chunk) push(x)
      return true
    }).then(() => {})
  }

  run(): Promise<void> {
    return this.foreach(() => {})
  }

  foreach0(push: (a: A) => P<boolean>): Promise<boolean> {
    return this.foreachChunks(async as => {
      for (const a of as) {
        const cont = await push(a)
        if (!cont) return false
      }
      return true
    })
  }

  fold<S>(s0: S, f: (s: S, a: A) => S): Promise<S> {
    return this.foldChunks(s0, (s, chunk) => {
      for (const a of chunk) {
        s = f(s, a)
      }
      return s
    })
  }

  foldChunks<S>(s0: S, f: (s: S, as: Chunk<A>) => S): Promise<S> {
    let s = s0
    return this.foreachChunks(async chunk => {
      s = f(s, chunk)
      return true
    }).then(() => s)
  }

  /**
   * Applies the specified function to each element and emits the result.
   *
   * ```ts
   * await Stream.from('Hello', 'World').map(a => a.length).toArray()
   * // => [5, 6]
   * ```
   */
  map<B>(f: (a: A) => B): Stream<B> {
    return this.simplePipe(push => chunk => push(chunk.map(f)))
  }

  flatMap<B>(f: (a: A) => Stream<B>): Stream<B> {
    return Stream.create(push => this.foreach0(a => f(a).foreachChunks(push)))
  }

  mapConcat<B>(f: (a: A) => B[]): Stream<B> {
    return Stream.create(push => this.foreach0(a => push(Chunk.seq(f(a)))))
  }

  filter<B>(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(push => async chunk => {
      const filtered = chunk.filter(f)
      return filtered.isEmpty ? true : await push(filtered)
    })
  }

  take(n: number): Stream<A> {
    return this.simplePipe(push => {
      let remaining = n
      return async chunk => {
        if (remaining > chunk.size) {
          remaining -= chunk.size
          return push(chunk)
        } else {
          await push(chunk.take(remaining))
          return false
        }
      }
    })
  }

  takeWhile(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(push => async chunk => {
      const filtered = chunk.takeWhile(f)
      const cont = await push(filtered)
      return cont && filtered.size === chunk.size
    })
  }

  drop(n: number): Stream<A> {
    return this.simplePipe(push => {
      let remaining = n
      let ok = false
      return async chunk => {
        if (ok) {
          return push(chunk)
        } else if (remaining > chunk.size) {
          remaining -= chunk.size
          return true
        } else if (remaining === chunk.size) {
          ok = true
          return true
        } else {
          ok = true
          return push(chunk.drop(remaining))
        }
      }
    })
  }

  dropWhile(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(push => {
      let ok = false
      return async chunk => {
        if (ok) {
          return push(chunk)
        }

        const filtered = chunk.dropWhile(f)
        if (filtered.isEmpty) {
          return true
        }
        ok = true
        return push(filtered)
      }
    })
  }

  scan<S>(zero: S, f: (s: S, a: A) => S): Stream<S> {
    return Stream.single(zero).concat(this.mapAccum(zero, (s, a) => {
      const s2 = f(s, a)
      return [s2, s2]
    }))
  }

  mapAccum<B, S>(zero: S, f: (s: S, a: A) => [S, B]): Stream<B> {
    return this.simplePipe(push => {
      let state = zero
      return async chunk => {
        const [chunk2, s2] = chunk.mapAccum(state, f)
        state = s2
        return push(chunk2)
      }
    })
  }

  zipWithIndex(): Stream<[A, number]> {
    return this.mapAccum<[A, number], number>(0, (i, a) => [i + 1, [a, i]])
  }

  intersperse<B>(separator: B): Stream<A | B> {
    return this.simplePipe(push => {
      let first = true
      return async chunk => {
        let head: Chunk<A> | undefined
        if (first) {
          first = false
          head = chunk.take(1)
          chunk = chunk.drop(1)
        }
        const as = new Array(chunk.size * 2)
        let i = 0
        for (const a of chunk) {
          as[i++] = separator
          as[i++] = a
        }
        return push(head ? head.concat(Chunk.seq(as)) : Chunk.seq(as))
      }
    })
  }

  /**
   * Adds a fixed size buffer in the flow that allows to store elements from a faster upstream until it becomes full.
   *
   * Emits when there is a pending element in the buffer and the downstream is ready.
   *
   * Backpressures when the buffer is full and the downstream backpressures.
   *
   * @param size The size of the buffer
   */
  buffer(size: number = 256, options: BufferOptions<A> = {}): Stream<A> {
    return Stream.createSimple(
      push => this.asQueue({ capacity: size, ...options }).use(queue => readQueue(queue, push)),
    )
  }

  /**
   * Behaves like the identity function, but requests `chunkSize` elements at a time from the input.
   * @param chunkSize
   */
  chunked(chunkSize: number): Stream<A> {
    return Stream.create(async push => {
      let buffer: Chunk<A> = Chunk.empty()
      const cont2 = await this.foreachChunks(async chunk => {
        let input = chunk
        let cont = true
        while (cont && input.size >= chunkSize - buffer.size) {
          const [kept, left] = input.splitAt(chunkSize - buffer.size)
          cont = await push(buffer.concat(kept))
          input = left
          buffer = Chunk.empty()
        }
        buffer = buffer.concat(input)
        return cont
      })
      if (cont2 && !buffer.isEmpty) {
        await push(buffer)
      }
      return cont2
    })
  }

  /**
   * Chunk up this stream into groups of the given size, with the last group possibly smaller than requested due to
   * end-of-stream.
   * @param size
   */
  grouped(size: number): Stream<A[]> {
    return this.chunked(size).chunks().map(c => c.toArray())
  }

  /**
   * Apply a sliding window over the stream and return the windows as groups of elements, with the last group possibly 
   * smaller than requested due to end-of-stream.
   * 
   * @param n The window size. Must be positive.
   * @param step The step size. Must be positive.
   */
  sliding(n: number, step: number = 1): Stream<A[]> {
    return Stream.createSimple<A[]>(async push => {
      let acc: A[] = []
      let count = 0
      const cont2 = await this.foreach0(async a => {
        if (count >= 0) {
          acc.push(a)
        }
        count++
        if (count === n) {
          const cont = await push(acc.slice())
          acc = acc.slice(step)
          count = count - step
          return cont
        } else {
          return true
        }
      })
      if (cont2 && count > n - step) {
        return push(acc)
      } else {
        return cont2
      }
    })
  }

  chunks(): Stream<Chunk<A>> {
    return Stream.createSimple(this.foreachChunks)
  }

  mapAsync<B>(f: (a: A) => Promise<B>, parallelism: number = 1): Stream<B> {
    if (parallelism === 1) {
      return this.flatMap(a => Stream.fromPromise(() => f(a)))
    } else {
      return this
        .unchunked()
        .map(f)
        .buffer(parallelism - 2, {
          // Avoid warnings due to unhandled promise rejection
          onCloseCleanup: (p: Promise<B>) => p.catch(err => console.error(err)),
        })
        .flatMap(p => Stream.fromPromise(() => p))
    }
  }

  mapAsyncUnordered<B>(f: (a: A) => Promise<B>, parallelism: number): Stream<B> {
    return this.flatMapMerge(a => Stream.fromPromise(() => f(a)), parallelism)
  }

  zip<B>(stream: Stream<B>): Stream<[A, B]> {
    return this.zipWith<B, [A, B]>(stream, (a, b) => [a, b])
  }

  zipWith<B, C>(stream: Stream<B>, f: (a: A, b: B) => C): Stream<C> {
    return this.zipAllWith(stream, (a, b) => {
      return a !== undefined && b !== undefined ? f(a, b) : undefined
    })
  }

  zipAllWith<B, C>(stream: Stream<B>, f: (a: A | undefined, b: B | undefined) => C | undefined): Stream<C> {
    return Stream.createSimple<C>(push => {
      async function takeToOption<AA>(take: Promise<Take<AA>>): Promise<AA | undefined> {
        const result = await take
        return result.fold(
          r => r,
          () => undefined,
          err => { throw err },
        )
      }

      async function run(leftQueue: QueueReader<Take<A>>, rightQueue: QueueReader<Take<B>>): Promise<boolean> {
        let leftDone = false
        let rightDone = false
        let done = false
        let cont = true
        while (cont && !done) {
          const left = !leftDone ? await takeToOption(leftQueue.take()) : undefined
          const right = !rightDone ? await takeToOption(rightQueue.take()) : undefined

          if (!leftDone && left === undefined) leftDone = true
          if (!rightDone && right === undefined) rightDone = true

          if (!leftDone || !rightDone) {
            const output = f(left, right)
            if (output !== undefined) {
              cont = await push(output)
            } else {
              done = true
            }
          } else {
            done = true
          }
        }

        return cont
      }

      return this.asQueue().use(leftQueue => stream.asQueue().use(rightQueue => run(leftQueue, rightQueue)))
    })
  }

  toQueue(queue: QueueWriter<A>): Promise<void> {
    return this.foreach0(async a => {
      await queue.offerIfNotClosed(a)
      return !queue.isClosed
    }).then(() => {})
  }

  toChunkQueue(queue: QueueWriter<Chunk<A>>): Promise<void> {
    return this.foreachChunks(async chunk => {
      await queue.offerIfNotClosed(chunk)
      return !queue.isClosed
    }).then(() => {})
  }

  asQueue(options: BufferAllOptions<A> = {}): Managed<QueueReader<Take<A>>> {
    return enumeratorToQueue(queue => this.toQueue(queue), options)
  }

  merge<B>(stream: Stream<B>): Stream<A | B> {
    return Stream.merge(this, stream)
  }

  flatMapMerge<B>(f: (a: A) => Stream<B>, parallelism: number): Stream<B> {
    return Stream.createConcurrent<B>(queue => {
      return this.mapAsync(async a => {
        return f(a).foreachChunks(async chunk => {
          await queue.offerIfNotClosed(chunk)
          return !queue.isClosed
        })
      }, parallelism).run()
    })
  }

  pipe<B>(flow: Pipe<A, B>): Stream<B> {
    return flow(this)
  }

  to<R>(sink: Sink<A, R>): Promise<R> {
    return sink(this)
  }

  toArray(): Promise<A[]> {
    return this.foldChunks<A[]>([], (s, a) => s.concat(a.toArray()))
  }

  concat<B>(stream: Stream<B>): Stream<A | B> {
    return Stream.create(async push => {
      const cont = await this.foreachChunks(push)
      if (cont) {
        return stream.foreachChunks(push)
      } else {
        return cont
      }
    })
  }

  repeat(): Stream<A> {
    return Stream.create(async push => {
      let cont = true
      while (cont) {
        cont = await this.foreachChunks(push)
      }
      return false
    })
  }

  throttle(duration: number, opts: ThrottleOptions<A> = {}): Stream<A> {
    const cost = opts.elements || opts.cost || 1
    const maximumBurst = opts.maximumBurst || cost
    const { costCalculation = () => 1, failOnPressure = false } = opts
    return Stream.createSimple(async push => {
      const bucket = new Semaphore(maximumBurst, cost)
      const timer = setInterval(() => bucket.release(cost), duration)
      return bracket(
        () => this.foreach0(async a => {
          const itemCost = costCalculation(a)
          if (failOnPressure) {
            if (!bucket.ask(itemCost)) {
              return Promise.reject(new Error('Maximum throttle throughput exceeded.'))
            }
          } else {
            await bucket.acquire(itemCost)
          }
          return push(a)
        }),
        () => clearInterval(timer),
      )
    })
  }

  debounce(duration: number): Stream<A> {
    return Stream.createSimpleConcurrent(queue => {
      let lastTimer: NodeJS.Timeout | undefined
      let lastCallback: () => void | undefined
      return this.foreach0(async a => {
        if (lastTimer) clearTimeout(lastTimer)
        lastTimer = setTimeout(() => {
          lastTimer = undefined
          queue.offerIfNotClosed(a)
            .catch((err: any) => console.error(err)) // Should not occurred
          if (lastCallback) lastCallback()
        }, duration)
        return !queue.isClosed
      }).then(() => {
        if (lastTimer) {
          return new Promise<void>(resolve => lastCallback = resolve)
        }
      })
    }, { capacity: 1, overflowStrategy: OverflowStrategy.SLIDING })
  }

  recover<B>(f: (err: any) => B): Stream<A | B> {
    return Stream.create(push => this.foreachChunks(chunk => push(chunk)).catch(err => push(Chunk.singleton(f(err)))))
  }

  onTerminate(f: () => P<void>): Stream<A> {
    return Stream.create(push => bracket(() => this.foreachChunks(chunk => push(chunk)), f))
  }

  tap(f: (a: A) => void): Stream<A> {
    return this.map(a => {
      f(a)
      return a
    })
  }

  async peel<R>(consumer: Consumer<A, R>): Promise<[R, Stream<A>]> {
    const chan = promiseChannel<[R, Stream<A>]>()
    this.chunks().asQueue().use(async queue => {
      const iteratee = consumer.iteratee()
      let resp: Chunk<A> | Consumer.Cont = Consumer.Cont
      while (!chan.closed && resp === Consumer.Cont) {
        const take = await queue.take()
        await take.fold(
          async a => { resp = await iteratee.update(a) },
          async () => {
            const r = await iteratee.result()
            chan.resolve([r, Stream.empty()])
          },
          async err => { chan.reject(err) },
        )
      }
      if (resp instanceof Chunk && !chan.closed) {
        const result = await iteratee.result()
        const streamEnd = promiseChannel<void>()
        chan.resolve([
          result,
          Stream.from(resp.toArray())
            .concat(Stream.create(push => readQueue(queue, push)))
            .onTerminate(() => streamEnd.resolve()),
        ])
        await streamEnd.promise
      }
    })
    return chan.promise
  }

  transduce<R>(consumer: Consumer<A, R>): Stream<R> {
    return Stream.createSimple(async push => {
      let iteratee = consumer.iteratee()
      const cont2 = await this.foreachChunks(async chunk => {
        let resp = await iteratee.update(chunk)
        let cont = true
        while (resp instanceof Chunk && cont) {
          const result = await iteratee.result()
          cont = await push(result)
          if (cont) {
            iteratee = consumer.iteratee()
            resp = await iteratee.update(resp)
          }
        }
        return cont
      })
      if (cont2) {
        const result = await iteratee.result()
        return push(result)
      }
      return cont2
    })
  }

  debug(prefix: string): Stream<A> {
    return this.tap(a => console.debug(`${new Date().toISOString()} - ${prefix} - ${a}`))
  }

  broadcast(): Stream<Stream<A>> {
    return this.pipe(broadcast<A>())
  }

  broadcastTo(...sinks: Sink<A, void>[]): Promise<void> {
    return this.broadcast()
      .take(sinks.length)
      .zip(Stream.from(sinks))
      .mapAsyncUnordered(([source, sink]) => source.to(sink), sinks.length)
      .run()
  }

  // alsoTo(sink: Sink<A, void>): Stream<A> {
  //   return Stream.create(push => {
  //     return this.broadcastTo(
  //       stream => stream.foreachChunks(push).then(() => {}),
  //       sink
  //     )
  //   })
  // }

  broadcastThrough<B>(...pipes: Pipe<A, B>[]): Stream<B> {
    return this.broadcast()
      .take(pipes.length)
      .zip(Stream.from(pipes))
      .flatMapMerge(([source, pipe]) => source.pipe(pipe), pipes.length)
  }

  balance(): Stream<Stream<A>> {
    return this.pipe(balance<A>())
  }

  balanceTo(...sinks: Sink<A, void>[]): Promise<void> {
    return this.balance()
      .take(sinks.length)
      .zip(Stream.from(sinks))
      .mapAsyncUnordered(([source, sink]) => source.to(sink), sinks.length)
      .run()
  }

  balanceThrough<B>(...pipes: Pipe<A, B>[]): Stream<B> {
    return this.balance()
      .take(pipes.length)
      .zip(Stream.from(pipes))
      .flatMapMerge(([source, pipe]) => source.pipe(pipe), pipes.length)
  }

  private unchunked(): Stream<A> {
    return Stream.createSimple(push => {
      return this.foreachChunks(async chunk => {
        for (const a of chunk) {
          const cont = await push(a)
          if (!cont) return false
        }
        return true
      })
    })
  }

  private simplePipe<B>(
    f: (push: (chunk: Chunk<B>) => P<boolean>) => (chunk: Chunk<A>) => P<boolean>,
  ): Stream<B> {
    return Stream.create(push => this.foreachChunks(f(push)))
  }
}

class StreamImpl<A> extends Stream<A> {
  constructor(public foreachChunks: (push: (a: Chunk<A>) => P<boolean>) => Promise<boolean>) {
    super()
  }
}

export namespace Stream {
  export function empty<A>(): Stream<A> {
    return create(async () => true)
  }

  export function single<A>(a: A): Stream<A> {
    return createSimple(async push => push(a))
  }

  export function repeat<A>(a: A): Stream<A> {
    return single(a).repeat()
  }

  export function from<A>(array: A[]): Stream<A> {
    return create(async push => push(Chunk.seq(array)))
  }

  export function fromPromise<A>(p: () => Promise<A>): Stream<A> {
    return createSimple(push => p().then(push))
  }

  export function range(start: number, end: number, increment: number = 1): Stream<number> {
    return unfold(
      start,
      increment > 0 ? n => n <= end : n => n >= end,
      n => [n + increment, n],
    )
  }

  export function unfold<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => [S, A]) {
    return unfoldAsync(s, cont, f)
  }

  export function unfoldAsync<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => P<[S, A]>) {
    return createSimple(async (push: (a: A) => P<boolean>) => {
      let state = s
      let sinkCont = true
      while (cont(state) && sinkCont) {
        const [state2, a] = await f(state)
        state = state2
        sinkCont = await push(a)
      }
      return sinkCont
    })
  }

  export function fromIterator<A>(it: () => Iterator<A>): Stream<A> {
    return createSimple(async (push: (a: A) => P<boolean>) => {
      const iterator = it()
      let done = false
      let cont = true
      while (cont && !done) {
        const step = iterator.next()
        done = step.done
        if (!done || step.value !== undefined) {
          cont = await push(step.value)
        }
      }
      return cont
    })
  }

  export function fromAsyncIterator<A>(it: () => AsyncIterator<A>): Stream<A> {
    return createSimple(async (push: (a: A) => P<boolean>) => {
      const iterator = it()
      let done = false
      let cont = true
      while (cont && !done) {
        const step = await iterator.next()
        done = step.done
        if (!done || step.value !== undefined) {
          cont = await push(step.value)
        }
      }
      return cont
    })
  }

  export function lazy<A>(f: () => Stream<A>): Stream<A> {
    return create(push => f().foreachChunks(push))
  }

  export function failed<A = never>(err: any): Stream<A> {
    return create<A>(() => Promise.reject(err))
  }

  export function createSimple<A>(foreach: (push: (a: A) => P<boolean>) => Promise<boolean>): Stream<A> {
    return create(push => foreach(a => push(Chunk.singleton(a))))
  }

  export function create<A>(foreach: (push: (a: Chunk<A>) => P<boolean>) => Promise<boolean>): Stream<A> {
    return new StreamImpl(foreach)
  }

  export function createSimpleConcurrent<A>(
    foreach: (queue: QueueWriter<A>) => Promise<void>,
    queueOptions: { capacity?: number, overflowStrategy?: OverflowStrategy } = {},
  ): Stream<A> {
    return createConcurrent(queue => foreach(queue.mapInput(a => Chunk.singleton(a))), queueOptions)
  }

  /**
   * Like Stream.create, but allow concurrent emitions
   * @param foreach
   */
  export function createConcurrent<A>(
    foreach: (queue: QueueWriter<Chunk<A>>) => Promise<void>,
    queueOptions: BufferAllOptions<Chunk<A>> = {},
  ): Stream<A> {
    return create(push => enumeratorToQueue(foreach, queueOptions).use(queue => readQueue(queue, push)))
  }

  export function merge<A, B>(s1: Stream<A>, s2: Stream<B>): Stream<A | B>
  export function merge<A, B, C>(s1: Stream<A>, s2: Stream<B>, s3: Stream<C>): Stream<A | B | C>
  export function merge<A, B, C, D>(s1: Stream<A>, s2: Stream<B>, s3: Stream<C>, s4: Stream<D>): Stream<A | B | C | D>
  export function merge<A, B, C, D, E>(
    s1: Stream<A>,
    s2: Stream<B>,
    s3: Stream<C>,
    s4: Stream<D>,
    s5: Stream<E>,
  ): Stream<A | B | C | D | E>
  export function merge(...streams: Stream<any>[]): Stream<any> {
    return Stream.createConcurrent(queue => Promise.all(streams.map(s => s.toChunkQueue(queue))).then(() => {}))
  }
}

export interface BufferOptions<A> {
  overflowStrategy?: OverflowStrategy,
  onCloseCleanup?: (remaining: A) => void,
}

export type BufferAllOptions<A> = { capacity?: number } & BufferOptions<A>

function enumeratorToQueue<A>(
  enumerator: (queue: QueueWriter<A>) => Promise<void>,
  options: BufferAllOptions<A> = {},
): Managed<QueueReader<Take<A>>> {
  const {
    capacity = 0,
    overflowStrategy = OverflowStrategy.BACK_PRESSURE,
    onCloseCleanup = () => {},
  } = options
  return new ManagedImpl<Queue<Take<A>>>(
    async () => {
      const queue = Queue.create<Take<A>>(capacity, overflowStrategy, remaining => {
        remaining.forEach(value => value.fold(
          onCloseCleanup,
          () => {},
          err => console.error(err),
        ))
      })
      enumerator(queue.mapInput(a => Take.value(a))).then(
        () => queue.offerIfNotClosed(Take.done()),
        err => queue.offerIfNotClosed(Take.fail(err)),
      )
      return queue
    },
    queue => queue.close(),
  )
}

function readQueue<A>(queue: QueueReader<Take<A>>, push: (a: A) => P<boolean>): Promise<boolean> {
  // TODO: refactor to avoid memory leaks
  async function run(): Promise<boolean> {
    const result = await queue.take()
    return result.fold(
      async a => {
        if (await push(a)) {
          return run()
        } else {
          return false
        }
      },
      async () => true,
      err => Promise.reject(err),
    )
  }
  return run()
}

export class Take<A> {
  static value<A>(a: A): Take<A> {
    return new Take<A>(value => value(a))
  }
  static done<A>(): Take<A> {
    return new Take<A>((value, done) => done())
  }
  static fail<A>(err: any): Take<A> {
    return new Take<A>((value, done, fail) => fail(err))
  }

  constructor(public fold: <T>(value: (a: A) => T, done: () => T, fail: (err: any) => T) => T) {}
}

export interface ThrottleOptions<A> {
  cost?: number,
  maximumBurst?: number,
  costCalculation?: (x: A) => number,
  failOnPressure?: boolean,
  elements?: number
}
