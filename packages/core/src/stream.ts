import { balance } from './balance'
import { broadcast } from './broadcast'
import { Consumer, continuousIteratee } from './consumer'
import { promiseChannel, safelyReturn, swallowErrors } from './helpers'
import { OverflowStrategy, Queue, QueueWriter } from './queue'
import { Semaphore } from './semaphore'

export type Pipe<I, O> = (s: Stream<I>) => Stream<O>
export type Sink<I, O> = (s: Stream<I>) => Promise<O>
export type FanOut = <A>() => [Sink<A, void>, Stream<A>]

export class Stream<A> implements AsyncIterable<A> {
  constructor(public iterable: AsyncIterable<A>) {}

  [Symbol.asyncIterator](): AsyncIterator<A> {
    return this.iterable[Symbol.asyncIterator]()
  }

  /**
   * Iterates over every element from the Stream, calling the function `f` on each of them,
   * and return a `Promise` which resolve when the Stream terminates.
   *
   * If an error occurred the `Promise` wil fail.
   *
   * @param f
   *
   * @example
   *
   * const items = [];
   * await Stream.range(0, 4).foreach(i => items.push(i));
   * console.log(items);
   * // => [0, 1, 2, 3]
   */
  async foreach(f: (a: A) => void): Promise<void> {
    for await (const a of this) f(a)
  }

  /**
   * Run the Stream ignoring all the elements, and return a `Promise` which resolve
   * when the Stream terminates, or fail if an error occurred.
   */
  run(): Promise<void> {
    return this.foreach(() => {})
  }

  /**
   * The given function `f` is invoked for every received element, giving it its previous output
   * (or the given `zero` value) and the element as input. The returned `Promise` will be completed
   * with value of the final function evaluation when the input stream ends, or completed with failure
   * if there is an error signaled in the stream.
   *
   * @param zero Initial value
   * @param f The reducer function
   *
   * @example
   *
   * await Stream.from(1, 2, 3, 4, 5).reduce(0, (acc, x) => acc + x)
   * // => 15
   */
  async reduce<S>(zero: S, f: (s: S, a: A) => S): Promise<S> {
    let s = zero
    for await (const a of this) {
      s = f(s, a)
    }
    return s
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
    return this.simplePipe(async function*(self) {
      for await (const a of self) yield f(a)
    })
  }

  /**
   * Transform each input element into a Stream of output elements that is then flattened into the
   * output Stream by concatenation, fully consuming one Stream after the other.
   *
   * @param f The transformation function
   *
   * @example
   *
   * await Stream(1, 2, 3).flatMap(i => Stream.repeat(i).take(i)).toArray()
   * // => [1, 2, 2, 3, 3, 3]
   */
  flatMap<B>(f: (a: A) => Stream<B>): Stream<B> {
    return this.simplePipe(async function*(self) {
      for await (const a of self) yield* f(a)
    })
  }

  /**
   * Transform each input element into an array of output elements that is
   * then flattened into the output stream.
   *
   * @param f The transformation function
   *
   * @example
   *
   * await Stream(1, 2, 3).mapConcat(i => [i, i]).toArray()
   * // => [1, 1, 2, 2, 3, 3]
   */
  mapConcat<B>(f: (a: A) => B[]): Stream<B> {
    return this.simplePipe(async function*(it) {
      for await (const a of it) yield* f(a)
    })
  }

  /**
   * Create a new Stream which emits only elements from the source Stream which match the supplied predicate.
   *
   * @param f The predicate function
   *
   * @example
   *
   * await Stream.range(1, 11).filter(a => a % 2 === 0).toArray()
   * // => [2, 4, 6, 8, 10]
   */
  filter(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(async function*(it) {
      for await (const a of it) {
        if (f(a)) yield a
      }
    })
  }

  /**
   * Like [`filter`](#filter), but the predicate `f` depends on the previously emitted and current elements.
   *
   * @param f The predicate function
   *
   * @example
   *
   * await Stream(1, -1, 2, -2, 3, -3, 4, -4)
   *    .filterWithPrevious((previous, current) => previous < current)
   *    .toArray()
   * // => [1, 2, 3, 4]
   */
  filterWithPrevious(f: (prev: A, cur: A) => boolean): Stream<A> {
    const self = this
    return self.peel(Consumer.head(), (head, tail) => {
      if (head !== undefined) {
        return Stream.fromAsyncIterator(async function*() {
          yield head
          let prev: A = head
          // TODO: Add a safe way to close the stream if sink cancel after head
          for await (const a of tail) {
            if (f(prev, a)) {
              prev = a
              yield a
            }
          }
        })
      } else {
        return Stream.empty()
      }
    })
  }

  /**
   * Emits the first `n` elements of this Stream.
   *
   * @param n The number of elements
   *
   * @example
   *
   * await Stream.range(0, 100).take(5).toArray()
   * // => [0, 1, 2, 3, 4]
   */
  take(n: number): Stream<A> {
    if (n === 0) {
      return Stream.empty()
    }
    return this.simplePipe(async function*(it) {
      let count = 0
      for await (const a of it) {
        yield a
        if (++count >= n) return
      }
    })
  }

  /**
   * Emits elements from the head of this Stream until the supplied predicate returns `false`.
   *
   * @param f Predicate
   *
   * @example
   *
   * await Stream.range(0,100).takeWhile(_ != 5).toArray()
   * // => [0, 1, 2, 3, 4]
   */
  takeWhile(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(async function*(it) {
      for await (const a of it) {
        if (!f(a)) return
        yield a
      }
    })
  }

  /**
   * Drops the `n` first elements of the input Stream, and then emits the rest.
   *
   * @param n The number of elements to drop
   *
   * @example
   *
   * await Stream.range(0, 10).drop(5).toArray()
   * // => [5, 6, 7, 8, 9]
   */
  drop(n: number): Stream<A> {
    return this.simplePipe(async function*(it) {
      let remaining = n
      for await (const a of it) {
        if (remaining === 0) {
          yield a
        } else {
          remaining--
        }
      }
    })
  }

  /**
   * Drops elements from the head of this Stream until the supplied predicate returns `false`.
   *
   * @param f The predicate function
   *
   * @example
   *
   * await Stream.range(0, 10).dropWhile(_ != 4).toArray()
   * // => [4, 5, 6, 7, 8, 9]
   */
  dropWhile(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(async function*(it) {
      let ok = false
      for await (const a of it) {
        if (ok) {
          yield a
        } else if (!f(a)) {
          ok = true
          yield a
        }
      }
    })
  }

  /**
   * Return a new Stream which emits its current value which starts at `zero` and then applies the current
   * and next value to the given function `f`, emitting the next current value.
   *
   * @param zero Initial value
   * @param f Transformation function
   *
   * @example
   *
   * await Stream.from(1, 2, 3, 4).scan(0, (acc, x) => acc + x).toArray()
   * // => [0, 1, 3, 6, 10]
   */
  scan<S>(zero: S, f: (s: S, a: A) => S): Stream<S> {
    return Stream.single(zero).concat(
      this.mapAccum(zero, (s, a) => {
        const s2 = f(s, a)
        return [s2, s2]
      }),
    )
  }

  /**
   * Transform this Stream by applying the function `f` to the current state (which starts at `zero`)
   * and the input value. The function must return a tuple containing the new state and the element
   * to emit.
   *
   * @param zero Initial state
   * @param f Transformation function
   *
   * @example
   *
   * await Stream.from("Hello", "World").mapAccum(0, (l, s) => (l + s.length, s[0])).toArray()
   * // => [[5, 'H'], [10, 'W']]
   */
  mapAccum<B, S>(zero: S, f: (s: S, a: A) => [S, B]): Stream<B> {
    return this.simplePipe(async function*(self) {
      let state = zero
      for await (const a of self) {
        const [newState, b] = f(state, a)
        state = newState
        yield b
      }
    })
  }

  /**
   * Return a Stream of tuples consisting of all input elements paired with their index. Indices start at 0.
   *
   * @example
   *
   * await Stream.from('Lorem', 'ipsum', 'dolor', 'sit', 'amet').zipWithIndex().toArray()
   * // => [['Lorem', 0], ['ipsum', 1], ['dolor', 2], ['sit', 3], ['amet', 4]]
   */
  zipWithIndex(): Stream<[A, number]> {
    return this.mapAccum<[A, number], number>(0, (i, a) => [i + 1, [a, i]])
  }

  /**
   * Emits the specified `separator` between every pair of elements in the source stream.
   *
   * @param separator
   *
   * @example
   *
   * await Stream.from(1, 2, 3, 4, 5).intersperse(0).toArray()
   * // => [1, 0, 2, 0, 3, 0, 4, 0, 5]
   */
  intersperse<B>(separator: B): Stream<A | B> {
    return this.simplePipe(async function*(it) {
      let first = true
      for await (const a of it) {
        if (!first) yield separator
        else first = false
        yield a
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
    return Stream.fromAsyncIterator(() =>
      passThrough(queue => this.toQueue(queue), { capacity: size, ...options }),
    )
  }

  async toQueue(queue: QueueWriter<A>): Promise<void> {
    for await (const a of this) {
      await queue.offerIfNotClosed(a)
      if (queue.isClosed) return
    }
  }

  /**
   * Chunk up this stream into groups of the given size, with the last group possibly smaller than requested due to
   * end-of-stream.
   *
   * @param size The group's size
   *
   * @example
   *
   * await Stream.range(0, 10).grouped(3).toArray()
   * // => [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]
   */
  grouped(size: number): Stream<A[]> {
    return this.simplePipe(async function*(it) {
      let buffer: A[] = []
      for await (const a of it) {
        buffer.push(a)
        if (buffer.length >= size) {
          yield buffer
          buffer = []
        }
      }
      if (buffer.length > 0) {
        yield buffer
      }
    })
  }

  /**
   * Apply a sliding window over the stream and return the windows as groups of elements, with the last group possibly
   * smaller than requested due to end-of-stream.
   *
   * @param n The window size. Must be positive.
   * @param step The step size. Must be positive.
   *
   * @example
   *
   * await Stream.range(0, 8).sliding(3, 2).toArray()
   * // => [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7]]
   */
  sliding(n: number, step: number = 1): Stream<A[]> {
    return this.simplePipe(async function*(it) {
      let acc: A[] = []
      let count = 0
      for await (const a of it) {
        if (count >= 0) {
          acc.push(a)
        }
        count++
        if (count === n) {
          yield acc.slice()
          acc = acc.slice(step)
          count = count - step
        }
      }
      if (count > n - step) {
        yield acc
      }
    })
  }

  /**
   * Emits only elements that are distinct from their immediate predecessors,
   * using `===` operator for comparison.
   */
  distinct(): Stream<A> {
    return this.filterWithPrevious((prev, current) => prev !== current)
  }

  /**
   * Transform this stream by applying the given function `f` to each of the elements as they pass
   * through this processing step. The function returns a `Promise` and the value of that promise will
   * be emitted downstream. The number of Promises that can run in parallel is given as the
   * `parallelism` argument.
   *
   * These Promises may complete in any order, but the elements that are
   * emitted downstream are in the same order as received from upstream.
   *
   * @param f The transformation function
   * @param parallelism The number of Promises that can run in parallel
   */
  mapAsync<B>(f: (a: A) => Promise<B>, parallelism: number = 1): Stream<B> {
    if (parallelism === 1) {
      return this.flatMap(a => Stream.fromPromise(() => f(a)))
    } else {
      return this.map(a => Wrapper.wrap(f(a)))
        .buffer(parallelism - 2, {
          // Avoid warnings due to unhandled promise rejection
          onCloseCleanup: (p: Wrapper<Promise<B>>) => swallowErrors(() => p.value),
        })
        .flatMap(p => Stream.fromPromise(() => p.value))
    }
  }

  /**
   * Transform this stream by applying the given function `f` to each of the elements as they pass
   * through this processing step. The function returns a `Promise` and the value of that promise will
   * be emitted downstream. The number of Promises that can run in parallel is given as the
   * `parallelism` argument.
   *
   * Each processed element will be emitted downstream as soon as it is ready, i.e. it is possible
   * that the elements are not emitted downstream in the same order as received from upstream.
   *
   * @param f The transformation function
   * @param parallelism The number of Promises that can run in parallel
   */
  mapAsyncUnordered<B>(f: (a: A) => Promise<B>, parallelism: number): Stream<B> {
    return this.flatMapMerge(a => Stream.fromPromise(() => f(a)), parallelism)
  }

  /**
   * Combine the elements of current and the given stream into a stream of tuples.
   *
   * Terminates when any of the streams completes.
   *
   * @param stream Stream to zip
   *
   * @example
   *
   * await Stream.from(1, 2, 3).zip(Stream.from(4, 5, 6, 7)).toArray()
   * // => [[1, 4], [2, 5], [3, 6]]
   */
  zip<B>(stream: Stream<B>): Stream<[A, B]> {
    return this.zipWith<B, [A, B]>(stream, (a, b) => [a, b])
  }

  /**
   * Put together the elements of current and the given streams into a stream of combined elements
   * using the given `f` function.
   *
   * @param stream Stream to zip with
   * @param f Combiner function
   *
   * @example
   *
   * await Stream.from(1, 2, 3).zipWith(Stream.from(4, 5, 6, 7), (l, r) => l + r).toArray()
   * // => [5, 7, 9]
   */
  zipWith<B, C>(stream: Stream<B>, f: (a: A, b: B) => C): Stream<C> {
    const self = this
    return Stream.fromAsyncIterator(async function*() {
      const leftIterator: AsyncIterator<A> = self[Symbol.asyncIterator]()
      try {
        const rightIterator = stream[Symbol.asyncIterator]()
        try {
          let done = false
          while (!done) {
            const left = await leftIterator.next()
            const right = await rightIterator.next()
            if (!left.done && !right.done) {
              yield f(left.value, right.value)
            } else {
              done = true
            }
          }
        } finally {
          await safelyReturn(rightIterator)
        }
      } finally {
        await safelyReturn(leftIterator)
      }
    })
  }

  zipAllWith<B, C>(stream: Stream<B>, f: (a: A | undefined, b: B | undefined) => C): Stream<C> {
    const self = this
    return Stream.fromAsyncIterator(async function*() {
      const leftIterator: AsyncIterator<A> = self[Symbol.asyncIterator]()
      try {
        const rightIterator = stream[Symbol.asyncIterator]()
        try {
          let leftDone = false
          let rightDone = false
          while (!leftDone || !rightDone) {
            const left = !leftDone ? await leftIterator.next() : { done: true, value: undefined }
            const right = !rightDone ? await rightIterator.next() : { done: true, value: undefined }

            if (!leftDone && left.done) leftDone = true
            if (!rightDone && right.done) rightDone = true

            if (!left.done || !right.done) {
              yield f(left.value, right.value)
            }
          }
        } finally {
          await safelyReturn(rightIterator)
        }
      } finally {
        await safelyReturn(leftIterator)
      }
    })
  }

  /**
   * Merge the given Stream to the current one, taking elements as they arrive from input streams,
   * picking randomly when several elements ready.
   *
   * @param stream The stream to merge with current one
   */
  merge<B>(stream: Stream<B>): Stream<A | B> {
    return Stream.merge(this, stream)
  }

  /**
   *
   * Transform each input element into a Stream of output elements that is then flattened into
   * the output stream by merging, where at most `parallelism` substreams are being consumed at any given time.
   *
   * @param f The transformation funcrion
   * @param parallelism The number of substreams that can be consumed at a given time
   */
  flatMapMerge<B>(f: (a: A) => Stream<B>, parallelism: number): Stream<B> {
    return Stream.createConcurrent<B>(queue =>
      this.mapAsync(a => f(a).toQueue(queue), parallelism).run(),
    )
  }

  /**
   * Transform this Stream with the given Pipe
   *
   * @param pipe Pipe to apply to the Stream
   */
  pipe<B>(pipe: Pipe<A, B>): Stream<B> {
    return pipe(this)
  }

  /**
   * Run this Stream with the given Sink
   *
   * @param sink Sink to run the Stream with
   */
  to<R>(sink: Sink<A, R>): Promise<R> {
    return sink(this)
  }

  /**
   * Return all the emitted elements in an array
   *
   * @example
   *
   * await Stream.from(1, 2, 3).toArray()
   * // => [1, 2, 3]
   */
  async toArray(): Promise<A[]> {
    const array: A[] = []
    for await (const a of this) {
      array.push(a)
    }
    return array
  }

  /**
   * Concatenates the current Stream with the given Stream `stream` so the first element emitted
   * by that stream is emitted after the last element of the current stream.
   *
   * @param stream The stream to append to the current stream
   *
   * @example
   *
   * await Stream.from(1, 2, 3).concat(Stream.from(4, 5, 6)).toArray()
   * // => [1, 2, 3, 4, 5, 6]
   */
  concat<B>(stream: Stream<B>): Stream<A | B> {
    return this.simplePipe(async function*(self) {
      yield* self
      yield* stream
    })
  }

  /**
   * Repeat the current stream indefintely.
   *
   * @example
   *
   * await Stream.from(1, 2, 3).repeat().take(10).toArray()
   * // => [1, 2, 3, 1, 2, 3, 1, 2, 3, 1]
   */
  repeat(): Stream<A> {
    return this.simplePipe(async function*(self) {
      while (true) yield* self
    })
  }

  /**
   *
   * Sends elements downstream with speed limited to `cost`/`duration` or `elements`/`duration`.
   *
   * Cost is calculating for each element individually by calling `costCalculation` function.
   * If no `costCalculation` is provided, the `cost` for each element is `1`.
   *
   * Throttle implements the token bucket model. There is a bucket with a given token capacity
   * (burst size or `maximumBurst`). Tokens drops into the bucket at a given rate and can be
   * spared for later use up to bucket capacity to allow some burstiness. Whenever stream wants
   * to send an element, it takes as many tokens from the bucket as element costs. If there isn't
   * any, throttle waits until the bucket accumulates enough tokens. Elements that costs more than
   * the allowed burst will be delayed proportionally to their cost minus available tokens, meeting
   * the target rate. Bucket is full when stream just materialized and started.
   *
   * @param duration
   * @param opts
   */
  throttle(duration: number, opts: ThrottleOptions<A> = {}): Stream<A> {
    const cost = opts.elements || opts.cost || 1
    const maximumBurst = opts.maximumBurst || cost
    const { costCalculation = () => 1, failOnPressure = false } = opts
    return this.simplePipe(async function*(self) {
      const bucket = new Semaphore(maximumBurst, cost)
      const timer = setInterval(() => bucket.release(cost), duration)
      try {
        for await (const a of self) {
          const itemCost = costCalculation(a)
          if (failOnPressure) {
            if (!bucket.ask(itemCost)) {
              throw new Error('Maximum throttle throughput exceeded.')
            }
          } else {
            await bucket.acquire(itemCost)
          }
          yield a
        }
      } finally {
        await swallowErrors(() => clearInterval(timer))
      }
    })
  }

  /**
   * Debounce the stream with a minimum period of `duration` between each element.
   *
   * @param duration Minimum period between elements
   */
  debounce(duration: number): Stream<A> {
    return Stream.createConcurrent(
      async queue => {
        let lastTimer: NodeJS.Timeout | undefined
        let done = false
        const endChannel = promiseChannel<void>()
        for await (const a of this) {
          if (lastTimer) clearTimeout(lastTimer)
          if (queue.isClosed) break
          lastTimer = setTimeout(async () => {
            lastTimer = undefined
            await queue.offerIfNotClosed(a)
            if (done) endChannel.resolve()
          }, duration)
        }
        done = true
        return lastTimer && endChannel.promise
      },
      { capacity: 1, overflowStrategy: OverflowStrategy.SLIDING },
    )
  }

  /**
   * Send a last element when an error occurred and gracefully complete the stream.
   *
   * @param f The recover function
   *
   * @example
   *
   * await Stream.from('Hello', 'World')
   *    .concat(Stream.failed(new Error('Failure')))
   *    .recover(e => e.message)
   *    .toArray()
   * // => ['Hello', 'World', 'Failure']
   */
  recover<B>(f: (err: any) => B): Stream<A | B> {
    return this.simplePipe(async function*(self) {
      try {
        yield* self
      } catch (e) {
        yield f(e)
      }
    })
  }

  /**
   * Switch to alternative `Stream` when an error occurred.
   *
   * It will stay in effect after an error has been recovered up to `attempts` number of times
   * so that each time there is an error, it is fed into the `f` and a new Stream is started.
   *
   * @private
   */
  recoverWithRetries<B>(attempts: number, f: (err: any) => Stream<B>): Stream<A | B> {
    if (attempts > 0) {
      return this.simplePipe(async function*(self) {
        try {
          yield* self
        } catch (e) {
          for await (const a of f(e).recoverWithRetries(attempts - 1, f)) yield a
        }
      })
    } else {
      return this as any // Weird error
    }
  }

  /**
   * Provide a function `f` that will be called when the current stream will terminate.
   * If the stream terminate with an error, the error is sent to the callback function.
   *
   * @private
   */
  onTerminate(f: (termination: Termination, err?: any) => Promise<void> | void): Stream<A> {
    return this.simplePipe(async function*(self) {
      let isComplete = false
      let isFailed = false
      try {
        yield* self
        isComplete = true
        await f(Termination.COMPLETED)
      } catch (e) {
        isFailed = true
        if (!isComplete) await f(Termination.FAILED, e)
        throw e
      } finally {
        if (!isComplete && !isFailed) await f(Termination.CANCELLED)
      }
    })
  }

  /**
   * Provide a function `f` that will be called for each emitted element without affecting the current
   * Stream.
   *
   * @param f The callback function
   *
   * @example
   *
   * const items: number[] = []
   * await Stream.range(0, 100).tap(x => items.push(x)).take(5).run()
   * console.log(items)
   * // => [0, 1, 2, 3, 4]
   */
  tap(f: (a: A) => void): Stream<A> {
    return this.map(a => {
      f(a)
      return a
    })
  }

  /**
   *
   * @param consumer
   *
   * @private
   */
  peel<R, AA, B>(
    consumer: Consumer<A, R, AA>,
    f: (head: R, tail: Stream<AA | A>) => Stream<B>,
  ): Stream<B> {
    return Stream.lazyAsync(async () => {
      const iteratee = consumer.iteratee()
      let resp: Consumer.Result<AA, R> | undefined
      const iterator: AsyncIterator<A> = this[Symbol.asyncIterator]()
      while (!resp) {
        const a = await iterator.next()
        if (!a.done) {
          resp = iteratee.next(a.value)
        } else {
          iterator.return && (await iterator.return())
          return f(iteratee.done(), Stream.empty())
        }
      }

      return f(
        resp.result,
        Stream.from(resp.remaining)
          .concat(Stream.fromAsyncIterator(() => iterator))
          .onTerminate(async () => {
            iterator.return && (await iterator.return())
          }),
      )
    })
  }

  /**
   *
   * @param consumer
   *
   * @private
   */
  transduce<R>(consumer: Consumer<A, R>): Stream<R> {
    return this.simplePipe(async function*(it) {
      const iteratee = continuousIteratee(consumer)
      for await (const a of it) {
        const resp = iteratee.next(a)
        if (resp) for (const o of resp) yield o
      }
    })
  }

  /**
   * Logs elements flowing through the stream as well as completion and erroring.
   *
   * @param name Name appearing in the message
   * @param extract Optional transformation to apply to each elements before log
   */
  log(name: string, extract: (a: A) => any = a => a): Stream<A> {
    const log = (...args: any[]) =>
      console.debug(`${new Date().toISOString()} - ${name} -`, ...args)
    return this.tap(a => log(extract(a))).onTerminate((err, isCompleted) => {
      if (err) {
        log('[FAILURE]', err)
        return
      }
      log(isCompleted ? '[COMPLETED]' : '[CANCELLED]')
    })
  }

  private async fanOutTo(fanOut: FanOut, ...sinks: Sink<A, void>[]): Promise<void> {
    const [sink, source] = fanOut<A>()
    await Promise.all([...sinks.map(s => source.to(s)), this.to(sink)])
  }

  private fanOutThrough<B>(fanOut: FanOut, ...pipes: Pipe<A, B>[]): Stream<B> {
    return Stream.lazy(() => {
      const [sink, source] = fanOut<A>()
      const stopStream = Stream.lazyAsync<B>(async () => {
        await this.to(sink)
        return Stream.empty()
      })
      return Stream.merge(stopStream, ...pipes.map(p => source.pipe(p)))
    })
  }

  /**
   * Broadcasts all emitted elements of the current Stream to the `sinks`, and returns a
   * `Promise` which resolve when all the sinks are terminated.
   *
   * Terminates when the current Stream completes, or when all the sinks are terminated.
   *
   * @param sinks The sinks to broadcast
   */
  broadcastTo(...sinks: Sink<A, void>[]): Promise<void> {
    return this.fanOutTo(broadcast, ...sinks)
  }

  // alsoTo(sink: Sink<A, void>): Stream<A> {
  //   const [s, source] = broadcast<A>()
  //   this.to(s)
  //   source.to(sink)
  // }

  /**
   * Broadcasts all emitted elements of the current Stream through the `pipes`, and returns
   * a new Stream merging all the elements emitted by those pipes.
   *
   * Terminates if the current Stream completes, if all the pipes are terminated,
   * or if the downstream sink is terminates.
   *
   * @param sinks The sinks to broadcast
   */
  broadcastThrough<B>(...pipes: Pipe<A, B>[]): Stream<B> {
    return this.fanOutThrough(broadcast, ...pipes)
  }

  balanceTo(...sinks: Sink<A, void>[]): Promise<void> {
    return this.fanOutTo(balance, ...sinks)
  }

  balanceThrough<B>(...pipes: Pipe<A, B>[]): Stream<B> {
    return this.fanOutThrough(balance, ...pipes)
  }

  private simplePipe<B>(f: (self: Stream<A>) => AsyncIterator<B>): Stream<B> {
    return Stream.fromAsyncIterator(() => f(this))
  }
}

export namespace Stream {
  export function empty<A>(): Stream<A> {
    return fromIterator<A>(function*() {})
  }

  export function single<A>(a: A): Stream<A> {
    return fromIterator<A>(function*() {
      yield a
    })
  }

  export function repeat<A>(a: A): Stream<A> {
    return fromIterator(function*() {
      while (true) yield a
    })
  }

  export function from<A>(array: A[]): Stream<A> {
    return fromIterable(array)
  }

  export function fromPromise<A>(p: () => Promise<A>): Stream<A> {
    return fromAsyncIterator(async function*() {
      const a = await p()
      yield a
    })
  }

  export function range(start: number, end: number, increment: number = 1): Stream<number> {
    return unfold(start, increment > 0 ? n => n < end : n => n > end, n => [n + increment, n])
  }

  export function unfold<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => [S, A]) {
    return unfoldAsync(s, cont, async s => f(s))
  }

  export function unfoldAsync<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => Promise<[S, A]>) {
    return fromAsyncIterator(async function*() {
      let state = s
      while (cont(state)) {
        const [newState, a] = await f(state)
        state = newState
        yield a
      }
    })
  }

  export function fromIterator<A>(it: () => Iterator<A>): Stream<A> {
    return fromIterable({ [Symbol.iterator]: it })
  }

  export function fromIterable<A>(iterable: Iterable<A>): Stream<A> {
    return Stream.fromAsyncIterator(async function*() {
      for (const a of iterable) yield a
    })
  }

  export function fromAsyncIterator<A>(it: () => AsyncIterator<A>): Stream<A> {
    return fromAsyncIterable({ [Symbol.asyncIterator]: it })
  }

  export function fromAsyncIterable<A>(iterable: AsyncIterable<A>): Stream<A> {
    return new Stream(iterable)
  }

  export function lazy<A>(f: () => Stream<A>): Stream<A> {
    return fromAsyncIterator(async function*() {
      yield* f()
    })
  }

  export function lazyAsync<A>(f: () => Promise<Stream<A>>): Stream<A> {
    return fromAsyncIterator(async function*() {
      const stream = await f()
      yield* stream
    })
  }

  export function failed<A = never>(err: any): Stream<A> {
    return fromIterator<A>(function*() {
      throw err
    })
  }

  /**
   * Like Stream.create, but allow concurrent emitions
   * @param foreach
   *
   * @private
   */
  export function createConcurrent<A>(
    foreach: (queue: QueueWriter<A>) => Promise<void>,
    queueOptions: BufferAllOptions<A> = {},
  ): Stream<A> {
    return fromAsyncIterator(() => passThrough(foreach, queueOptions))
  }

  export function merge<A, B>(s1: Stream<A>, s2: Stream<B>): Stream<A | B>
  export function merge<A, B, C>(s1: Stream<A>, s2: Stream<B>, s3: Stream<C>): Stream<A | B | C>
  export function merge<A, B, C, D>(
    s1: Stream<A>,
    s2: Stream<B>,
    s3: Stream<C>,
    s4: Stream<D>,
  ): Stream<A | B | C | D>
  export function merge<A, B, C, D, E>(
    s1: Stream<A>,
    s2: Stream<B>,
    s3: Stream<C>,
    s4: Stream<D>,
    s5: Stream<E>,
  ): Stream<A | B | C | D | E>
  export function merge<A>(...streams: Stream<A>[]): Stream<A>
  export function merge(...streams: Stream<any>[]): Stream<any> {
    return Stream.createConcurrent(queue =>
      Promise.all(streams.map(s => s.toQueue(queue))).then(() => {}),
    )
  }
}

export interface BufferOptions<A> {
  overflowStrategy?: OverflowStrategy
  onCloseCleanup?: (remaining: A) => void
}

export type BufferAllOptions<A> = { capacity?: number } & BufferOptions<A>

async function* passThrough<A>(
  producer: (queue: QueueWriter<A>) => Promise<void>,
  options: BufferAllOptions<A> = {},
): AsyncIterableIterator<A> {
  const {
    capacity = 0,
    overflowStrategy = OverflowStrategy.BACK_PRESSURE,
    onCloseCleanup = () => {},
  } = options

  const queue = Queue.create<Step<A>>(capacity, overflowStrategy, remaining => {
    remaining.forEach(value => {
      if (value.type === StepType.NEXT) {
        onCloseCleanup(value.value)
      } else if (value.type === StepType.FAILED) {
        console.error(value.error)
      }
    })
  })

  producer(queue.mapInput(a => Step.value(a))).then(
    () => queue.offerIfNotClosed(Step.done()),
    err => queue.offerIfNotClosed(Step.fail(err)),
  )

  try {
    for await (const step of queue) {
      if (step.type === StepType.NEXT) {
        yield step.value
      } else if (step.type === StepType.FAILED) {
        throw step.error
      } else {
        break
      }
    }
  } finally {
    queue.close()
  }
}

export enum StepType {
  NEXT,
  DONE,
  FAILED,
}

export namespace Step {
  export const value = <A>(x: A): Step<A> => ({ type: StepType.NEXT, value: x })
  export const done = <A>(): Step<A> => ({ type: StepType.DONE })
  export const fail = <A>(error: any): Step<A> => ({ type: StepType.FAILED, error })
}

export type Step<A> =
  | Readonly<{ type: StepType.NEXT; value: A }>
  | Readonly<{ type: StepType.DONE }>
  | Readonly<{ type: StepType.FAILED; error: any }>

export enum Termination {
  COMPLETED,
  CANCELLED,
  FAILED,
}

type Wrapper<A> = { value: A }
namespace Wrapper {
  export const wrap = <A>(value: A) => ({ value })
}

export interface ThrottleOptions<A> {
  cost?: number
  maximumBurst?: number
  costCalculation?: (x: A) => number
  failOnPressure?: boolean
  elements?: number
}
