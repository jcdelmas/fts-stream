import { balance } from './balance'
import { broadcast } from './broadcast'
import { Chunk } from './chunk'
import { Consumer } from './consumer'
import { Managed, ManagedImpl } from './managed'
import { bracket, promiseChannel } from './promises'
import { OverflowStrategy, Queue, QueueReader, QueueWriter } from './queue'
import { Semaphore } from './semaphore'
import { P } from './helpers'

export type Pipe<I, O> = (s: Stream<I>) => Stream<O>
export type Sink<I, O> = (s: Stream<I>) => Promise<O>

export abstract class Stream<A> {
  /**
   * @private
   */
  abstract foreachChunks(push: (as: Chunk<A>) => P<boolean>): Promise<boolean>

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
  foreach(f: (a: A) => void): Promise<void> {
    return this.foreachChunks(chunk => {
      for (const x of chunk) f(x)
      return true
    }).then(() => {})
  }

  /**
   * Run the Stream ignoring all the elements, and return a `Promise` which resolve
   * when the Stream terminates, or fail if an error occurred.
   */
  run(): Promise<void> {
    return this.foreach(() => {})
  }

  /**
   * @private
   */
  foreach0(push: (a: A) => P<boolean>): Promise<boolean> {
    return this.foreachChunks(async as => {
      for (const a of as) {
        const cont = await push(a)
        if (!cont) return false
      }
      return true
    })
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
  reduce<S>(zero: S, f: (s: S, a: A) => S): Promise<S> {
    return this.reduceChunks(zero, (s, chunk) => {
      for (const a of chunk) {
        s = f(s, a)
      }
      return s
    })
  }

  /**
   *
   * @param zero
   * @param f
   *
   * @private
   */
  reduceChunks<S>(zero: S, f: (s: S, as: Chunk<A>) => S): Promise<S> {
    let s = zero
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
    return Stream.createChunked(push => this.foreach0(a => f(a).foreachChunks(push)))
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
    return Stream.createChunked(push => this.foreach0(a => push(Chunk.seq(f(a)))))
  }

  /**
   * Create a new Stream which emits only elements from the source Stream which match the supplied predicate.
   *
   * @param f The predicate function
   *
   * @example
   *
   * await Stream.range(1, 10).filter(a => a % 2 === 0).toArray()
   * // => [2, 4, 6, 8, 10]
   */
  filter<B>(f: (a: A) => boolean): Stream<A> {
    return this.simplePipe(push => async chunk => {
      const filtered = chunk.filter(f)
      return filtered.isEmpty ? true : await push(filtered)
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
    return Stream.create(async push => {
      const [head, tail] = await this.peel(Consumer.head())
      if (head !== undefined) {
        let prev: A = head
        const cont = await push(head)
        if (cont) {
          return tail.foreach0(a => {
            if (f(prev, a)) {
              prev = a
              return push(a)
            } else {
              return true
            }
          })
        } else {
          return false
        }
      } else {
        return true
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
    return this.simplePipe(push => async chunk => {
      const filtered = chunk.takeWhile(f)
      const cont = await push(filtered)
      return cont && filtered.size === chunk.size
    })
  }

  /**
   * Drops the `n` first elements of the input Stream, and then emits the rest.
   *
   * @param n The number of elements to drop
   *
   * @example
   *
   * await Stream.range(0,10).drop(5).toArray()
   * // => [5, 6, 7, 8, 9]
   */
  drop(n: number): Stream<A> {
    return this.simplePipe(push => {
      let remaining = n
      let ok = false
      return async chunk => {
        if (ok) {
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

  /**
   * Drops elements from the head of this Stream until the supplied predicate returns `false`.
   *
   * @param f The predicate function
   *
   * @example
   *
   * await Stream.range(0,10).dropWhile(_ != 4).toArray()
   * // => [4, 5, 6, 7, 8, 9]
   */
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
    return this.simplePipe(push => {
      let state = zero
      return async chunk => {
        const [chunk2, s2] = chunk.mapAccum(state, f)
        state = s2
        return push(chunk2)
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
    return Stream.create(push =>
      this.asQueue({ capacity: size, ...options }).use(queue => readQueue(queue, push)),
    )
  }

  /**
   * Behaves like the identity function, but requests `chunkSize` elements at a time from the input.
   *
   * @param chunkSize The size of the chunks
   *
   * @private
   */
  chunked(chunkSize: number): Stream<A> {
    return Stream.createChunked(async push => {
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
   *
   * @param size The group's size
   *
   * @example
   *
   * await Stream.range(0, 10).grouped(3).toArray()
   * // => [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]
   */
  grouped(size: number): Stream<A[]> {
    return this.chunked(size)
      .chunks()
      .map(c => c.toArray())
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
    return Stream.create<A[]>(async push => {
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

  /**
   * Emits only elements that are distinct from their immediate predecessors,
   * using `===` operator for comparison.
   */
  distinct(): Stream<A> {
    return this.filterWithPrevious((prev, current) => prev !== current)
  }

  /**
   * @private
   */
  chunks(): Stream<Chunk<A>> {
    return Stream.create(this.foreachChunks)
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
      return this.unchunked()
        .map(f)
        .buffer(parallelism - 2, {
          // Avoid warnings due to unhandled promise rejection
          onCloseCleanup: (p: Promise<B>) => p.catch(err => console.error(err)),
        })
        .flatMap(p => Stream.fromPromise(() => p))
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
    return this.zipAllWith(stream, (a, b) => {
      return a !== undefined && b !== undefined ? f(a, b) : undefined
    })
  }

  zipAllWith<B, C>(
    stream: Stream<B>,
    f: (a: A | undefined, b: B | undefined) => C | undefined,
  ): Stream<C> {
    return Stream.create<C>(push => {
      async function takeToOption<AA>(take: Promise<Take<AA>>): Promise<AA | undefined> {
        const result = await take
        return result.fold(
          r => r,
          () => undefined,
          err => {
            throw err
          },
        )
      }

      async function run(
        leftQueue: QueueReader<Take<A>>,
        rightQueue: QueueReader<Take<B>>,
      ): Promise<boolean> {
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

      return this.asQueue().use(leftQueue =>
        stream.asQueue().use(rightQueue => run(leftQueue, rightQueue)),
      )
    })
  }

  /**
   * @private
   */
  toQueue(queue: QueueWriter<A>): Promise<void> {
    return this.foreach0(async a => {
      await queue.offerIfNotClosed(a)
      return !queue.isClosed
    }).then(() => {})
  }

  /**
   *
   * @param queue
   *
   * @private
   */
  toChunkQueue(queue: QueueWriter<Chunk<A>>): Promise<void> {
    return this.foreachChunks(async chunk => {
      await queue.offerIfNotClosed(chunk)
      return !queue.isClosed
    }).then(() => {})
  }

  /**
   *
   * @param options
   *
   * @private
   */
  asQueue(options: BufferAllOptions<A> = {}): Managed<QueueReader<Take<A>>> {
    return enumeratorToQueue(queue => this.toQueue(queue), options)
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
    return Stream.createConcurrent<B>(queue => {
      return this.mapAsync(async a => {
        return f(a).foreachChunks(async chunk => {
          await queue.offerIfNotClosed(chunk)
          return !queue.isClosed
        })
      }, parallelism).run()
    })
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
  toArray(): Promise<A[]> {
    return this.reduceChunks<A[]>([], (s, a) => s.concat(a.toArray()))
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
    return Stream.createChunked(async push => {
      const cont = await this.foreachChunks(push)
      if (cont) {
        return stream.foreachChunks(push)
      } else {
        return cont
      }
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
    return Stream.createChunked(async push => {
      let cont = true
      while (cont) {
        cont = await this.foreachChunks(push)
      }
      return false
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
    return Stream.create(async push => {
      const bucket = new Semaphore(maximumBurst, cost)
      const timer = setInterval(() => bucket.release(cost), duration)
      return bracket(
        () =>
          this.foreach0(async a => {
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

  /**
   * Debounce the stream with a minimum period of `duration` between each element.
   *
   * @param duration Minimum period between elements
   */
  debounce(duration: number): Stream<A> {
    return Stream.createSimpleConcurrent(
      queue => {
        let lastTimer: NodeJS.Timeout | undefined
        let lastCallback: () => void | undefined
        return this.foreach0(async a => {
          if (lastTimer) clearTimeout(lastTimer)
          lastTimer = setTimeout(() => {
            lastTimer = undefined
            queue.offerIfNotClosed(a).catch((err: any) => console.error(err)) // Should not occurred
            if (lastCallback) lastCallback()
          }, duration)
          return !queue.isClosed
        }).then(() => {
          if (lastTimer) {
            return new Promise<void>(resolve => (lastCallback = resolve))
          }
        })
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
    return Stream.createChunked(push =>
      this.foreachChunks(push).catch(err => push(Chunk.singleton(f(err)))),
    )
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
      return Stream.createChunked(push =>
        this.foreachChunks(push).catch(err =>
          f(err)
            .recoverWithRetries(attempts - 1, f)
            .foreachChunks(push),
        ),
      )
    } else {
      return this
    }
  }

  /**
   * Provide a function `f` that will be called when the current stream will terminate.
   * If the stream terminate with an error, the error is sent to the callback function.
   *
   * @private
   */
  onTerminate(f: (err: any | undefined, isComplete: boolean) => P<void>): Stream<A> {
    return Stream.createChunked(push =>
      this.foreachChunks(push).then(
        cont => {
          f(undefined, cont)
          return cont
        },
        err => {
          f(err, true)
          throw err
        },
      ),
    )
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
  async peel<R>(consumer: Consumer<A, R>): Promise<[R, Stream<A>]> {
    const chan = promiseChannel<[R, Stream<A>]>()
    this.chunks()
      .asQueue()
      .use(async queue => {
        const iteratee = consumer.iteratee()
        let resp: Chunk<A> | Consumer.Cont = Consumer.Cont
        while (!chan.closed && resp === Consumer.Cont) {
          const take = await queue.take()
          await take.fold(
            async a => {
              resp = await iteratee.update(a)
            },
            async () => {
              const r = await iteratee.result()
              chan.resolve([r, Stream.empty()])
            },
            async err => {
              chan.reject(err)
            },
          )
        }
        if (resp instanceof Chunk && !chan.closed) {
          const result = await iteratee.result()
          const streamEnd = promiseChannel<void>()
          chan.resolve([
            result,
            Stream.from(resp.toArray())
              .concat(Stream.createChunked(push => readQueue(queue, push)))
              .onTerminate(() => streamEnd.resolve()),
          ])
          await streamEnd.promise
        }
      })
    return chan.promise
  }

  /**
   *
   * @param consumer
   *
   * @private
   */
  transduce<R>(consumer: Consumer<A, R>): Stream<R> {
    return Stream.create(async push => {
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

  /**
   * @private
   */
  broadcast(): Stream<Stream<A>> {
    return this.pipe(broadcast<A>())
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
    return Stream.create(push => {
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
    return Stream.createChunked(push => this.foreachChunks(f(push)))
  }
}

class StreamImpl<A> extends Stream<A> {
  constructor(public foreachChunks: (push: (a: Chunk<A>) => P<boolean>) => Promise<boolean>) {
    super()
  }
}

export namespace Stream {
  export function empty<A>(): Stream<A> {
    return createChunked(async () => true)
  }

  export function single<A>(a: A): Stream<A> {
    return create(async push => push(a))
  }

  export function repeat<A>(a: A): Stream<A> {
    return single(a).repeat()
  }

  export function from<A>(array: A[]): Stream<A> {
    return createChunked(async push => push(Chunk.seq(array)))
  }

  export function fromPromise<A>(p: () => Promise<A>): Stream<A> {
    return create(push => p().then(push))
  }

  export function range(start: number, end: number, increment: number = 1): Stream<number> {
    return unfold(start, increment > 0 ? n => n <= end : n => n >= end, n => [n + increment, n])
  }

  export function unfold<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => [S, A]) {
    return unfoldAsync(s, cont, f)
  }

  export function unfoldAsync<S, A>(s: S, cont: (s: S) => boolean, f: (s: S) => P<[S, A]>) {
    return create(async (push: (a: A) => P<boolean>) => {
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
    return create(async (push: (a: A) => P<boolean>) => {
      const iterator = it()
      let done = false
      let cont = true
      while (cont && !done) {
        const step = iterator.next()
        done = !!step.done
        if (!done || step.value !== undefined) {
          cont = await push(step.value)
        }
      }
      return cont
    })
  }

  export function fromAsyncIterator<A>(it: () => AsyncIterator<A>): Stream<A> {
    return fromAsyncIterable({ [Symbol.asyncIterator]: it })
  }

  export function fromAsyncIterable<A>(iterable: AsyncIterable<A>): Stream<A> {
    return create(async (push: (a: A) => P<boolean>) => {
      let cont = true
      for await (const a of iterable) {
        cont = await push(a)
        if (!cont) {
          break
        }
      }
      return cont
    })
  }

  export function lazy<A>(f: () => Stream<A>): Stream<A> {
    return createChunked(push => f().foreachChunks(push))
  }

  export function failed<A = never>(err: any): Stream<A> {
    return createChunked<A>(() => Promise.reject(err))
  }

  export function create<A>(foreach: (push: (a: A) => P<boolean>) => Promise<boolean>): Stream<A> {
    return createChunked(push => foreach(a => push(Chunk.singleton(a))))
  }

  /**
   *
   * @param foreach
   *
   * @private
   */
  export function createChunked<A>(
    foreach: (push: (a: Chunk<A>) => P<boolean>) => Promise<boolean>,
  ): Stream<A> {
    return new StreamImpl(foreach)
  }

  /**
   *
   * @param foreach
   * @param queueOptions
   *
   * @private
   */
  export function createSimpleConcurrent<A>(
    foreach: (queue: QueueWriter<A>) => Promise<void>,
    queueOptions: {
      capacity?: number
      overflowStrategy?: OverflowStrategy
    } = {},
  ): Stream<A> {
    return createConcurrent(queue => foreach(queue.mapInput(a => Chunk.singleton(a))), queueOptions)
  }

  /**
   * Like Stream.create, but allow concurrent emitions
   * @param foreach
   *
   * @private
   */
  export function createConcurrent<A>(
    foreach: (queue: QueueWriter<Chunk<A>>) => Promise<void>,
    queueOptions: BufferAllOptions<Chunk<A>> = {},
  ): Stream<A> {
    return createChunked(push =>
      enumeratorToQueue(foreach, queueOptions).use(queue => readQueue(queue, push)),
    )
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
  export function merge(...streams: Stream<any>[]): Stream<any> {
    return Stream.createConcurrent(queue =>
      Promise.all(streams.map(s => s.toChunkQueue(queue))).then(() => {}),
    )
  }
}

export interface BufferOptions<A> {
  overflowStrategy?: OverflowStrategy
  onCloseCleanup?: (remaining: A) => void
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
        remaining.forEach(value => value.fold(onCloseCleanup, () => {}, err => console.error(err)))
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
  cost?: number
  maximumBurst?: number
  costCalculation?: (x: A) => number
  failOnPressure?: boolean
  elements?: number
}
