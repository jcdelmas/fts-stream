import { Pipe, Stream } from '../stream'
import { delay } from '../promises'

export function checkStream<A>(stream: Stream<A>, expected: A[]): Promise<void> {
  return stream.toArray().then(result => { expect(result).toEqual(expected) })
}

export function testStream<A>(name: string, stream: Stream<A>, expected: A[]) {
  test(name, async () => await checkStream(stream, expected))
}

export function testFlow<A, B>(
  name: string,
  stream: Stream<A>,
  streamFlow: (s: Stream<A>) => Stream<B>,
  arrayFlow: (as: A[]) => B[]
) {
  test(name, async () => {
    const as = await stream.toArray()
    const actual = await streamFlow(stream).toArray()
    const expected = arrayFlow(as)
    expect(actual).toEqual(expected)
  })
}

/**
 * Check that a stream return the same result when executed twice
 * @param stream
 */
export function testStreamPurity<A>(stream: Stream<A>) {
  testStreamEquals('purity', stream, stream)
}

export function testStreamEquals<A>(name: string, stream1: Stream<A>, stream2: Stream<A>) {
  test(name, async () => {
    const r1 = await stream1.toArray()
    const r2 = await stream2.toArray()
    expect(r1).toEqual(r2)
  })
}

export function withStream<A>(f: (...args: any[]) => Stream<A>) {
  return new class {
    test(name: string, expected: A[], ...args: any[]): this {
      testStream(name, f(...args), expected)
      return this
    }
  }
}

const streams: [string, Stream<number>][] = [
  ['empty', Stream.empty()],
  ['single', Stream.single(2)],
  ['unchunked', Stream.range(1, 5)],
  ['single chunk', Stream.from([1, 8, 4, 7, 2, 9])],
  ['chunked', Stream.range(1, 5).flatMap(a => Stream.from([a, 9, 2, 6, 1, 10 - a]))],
]

export function foreachStreams(f: (name: string, stream: Stream<number>) => void) {
  streams.forEach((args) => f(...args))
}

export function withFlowProp(f: (...args: any[]) => [(s: Stream<any>) => Stream<any>, (as: any[]) => any[]]) {
  return new class {
    test<B>(name: string, array: B[], ...args: any[]): this {
      const [streamTransform, arrayTransform] = f(...args)
      testStream(name, streamTransform(Stream.from(array)), arrayTransform(array))
      return this
    }
    testStream<A>(name: string, stream: Stream<A>, ...args: any[]): this {
      const [streamTransform, arrayTransform] = f(...args)
      testFlow(name, stream, streamTransform, arrayTransform)
      return this
    }
    testStreams(...args: any[]): this {
      return this.testStreamsWithName(s => s, ...args)
    }
    testStreamsWithName(nameTransform: (s: string) => string, ...args: any[]): this {
      const [streamTransform, arrayTransform] = f(...args)
      streams.forEach(([name, stream]) => {
        testFlow(nameTransform(name), stream, streamTransform, arrayTransform)
      })
      return this
    }
  }
}

export function delayedArray<A>(array: A[], interval: number): Stream<A> {
  return Stream.unfoldAsync<number, A>(
    0,
    i => i < array.length,
    i => delay(interval).then<[number, A]>(() => [i + 1, array[i]])
  )
}

export function delayedPipe<A>(duration: number): Pipe<A, A> {
  return s => s.mapAsync(async a => {
    await delay(duration)
    return a
  })
}
