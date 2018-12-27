import _ from 'lodash'
import { delay } from '../promises'
import { Stream } from '../stream'
import { delayedArray, foreachStreams, testStreamEquals, testStreamPurity, withFlowProp } from './helpers'

describe('map', () => {
  withFlowProp(<A>(f: (a: A) => any) => [(s: Stream<A>) => s.map(f), (a: A[]) => a.map(f)])
    .testStreams((a: number) => a + 1)
    .test('string to number', ['foo', 'bar', 'foobar'], (s: string) => s.length)

  testStreamPurity(Stream.range(1, 5).map(n => n + 1))
})

describe('flatMap', () => {
  withFlowProp(
    () => [
      (s: Stream<number>) => s.flatMap((a: number) => Stream.range(a, a + 5)),
      (as: number[]) => _.flatten(as.map(a => _.range(a, a + 6, 1))),
    ],
  ).testStreamsWithName(s => `${s} to unchunked`)
  withFlowProp(
    () => [
      (s: Stream<number>) => s.flatMap(a => Stream.from([a, a + 3, a - 2])),
      (as: number[]) => _.flatten(as.map(a => [a, a + 3, a - 2])),
    ],
  ).testStreamsWithName(s => `${s} to chunked`)

  testStreamPurity(Stream.range(1, 5).flatMap(n => Stream.single(n + 1)))

  // Laws
  const f: (n: number) => Stream<number> = n => Stream.range(n, n + 5)
  const g: (n: number) => Stream<number> = n => Stream.from([n, n + 2])
  testStreamEquals(
    'left identity',
    Stream.single(5).flatMap(f),
    f(5),
  )
  foreachStreams((name, stream) => {
    testStreamEquals(
      `right identity - ${name}`,
      stream.flatMap(a => Stream.single(a)),
      stream,
    )
  })
  foreachStreams((name, stream) => {
    testStreamEquals(
      `associativity - ${name}`,
      stream.flatMap(f).flatMap(g),
      stream.flatMap(a => f(a).flatMap(g)),
    )
  })
})

describe('mapConcat', () => {
  withFlowProp(<A>(f: (a: A) => any) => [(s: Stream<A>) => s.mapConcat(f), (a: A[]) => _.flatten(a.map(f))])
    .testStreams((a: number) => [a, a + 2, a - 3])

  testStreamPurity(Stream.range(1, 5).mapConcat((a: number) => [a, a + 2, a - 3]))
})

describe('take', () => {
  withFlowProp(<A>(n: number) => [s => s.take(n), a => a.slice(0, n)])
    .testStreamsWithName(s => `${s} - take none`, 0)
    .testStreamsWithName(s => `${s} - take 2`, 2)
    .testStreamsWithName(s => `${s} - take all`, 1000)

  testStreamPurity(Stream.range(1, 5).take(3))
})

describe('filter', () => {
  withFlowProp(<A>(f: (a: A) => boolean) => [(s: Stream<A>) => s.filter(f), (a: A[]) => a.filter(f)])
    .testStreamsWithName(s => `${s} - filter some`, (a: number) => a < 3)
    .testStreamsWithName(s => `${s} - filter none`, () => true)
    .testStreamsWithName(s => `${s} - filter all`, () => false)

  testStreamPurity(Stream.range(1, 5).filter(n => n < 3))
})

describe('takeWhile', () => {
  withFlowProp(<A>(f: (a: A) => boolean) => [(s: Stream<A>) => s.takeWhile(f), (a: A[]) => _.takeWhile(a, f)])
    .testStreamsWithName(s => `${s} - basic`, (a: number) => a < 3)
    .testStreamsWithName(s => `${s} - take all`, () => true)
    .testStreamsWithName(s => `${s} - take none`, () => false)

  testStreamPurity(Stream.range(1, 5).takeWhile(n => n < 3))
})

describe('drop', () => {
  withFlowProp(<A>(n: number) => [(s: Stream<A>) => s.drop(n), (a: A[]) => a.slice(n)])
    .testStreamsWithName(s => `${s} - drop none`, 0)
    .testStreamsWithName(s => `${s} - drop 2`, 2)
    .testStreamsWithName(s => `${s} - drop all`, 1000)

  testStreamPurity(Stream.range(1, 5).drop(2))
})

describe('dropWhile', () => {
  withFlowProp(<A>(f: (a: A) => boolean) => [(s: Stream<A>) => s.dropWhile(f), (a: A[]) => _.dropWhile(a, f)])
    .testStreamsWithName(s => `${s} - basic`, (a: number) => a < 3)
    .testStreamsWithName(s => `${s} - drop all`, () => true)
    .testStreamsWithName(s => `${s} - drop none`, () => false)

  testStreamPurity(Stream.range(1, 5).dropWhile(n => n < 3))
})

describe('scan', () => {
  withFlowProp(<A>(init: any, f: (b: any, a: A) => any) => [
    (s: Stream<A>) => s.scan(init, f),
    (a: A[]) => scan(a, init, f),
  ])
    .testStreams(0, (s: number, a: number) => s + a)

  testStreamPurity(Stream.range(1, 5).scan<number>(0, (s, a) => s + a))
})

function scan<A, S>(array: A[], zero: S, f: (s: S, a: A) => S) {
  function loop(i: number, s: S): S[] {
    return [s, ...(i < array.length ? loop(i + 1, f(s, array[i])) : [])]
  }
  return loop(0, zero)
}

describe('mapAccum', () => {
  withFlowProp(
    <A>(
      init: any,
      f: (b: any, a: A) => [any, any],
    ) => [(s: Stream<A>) => s.mapAccum(init, f), (a: A[]) => mapAccum(a, init, f)],
  ).testStreams(0, (s: number, a: number) => [a, s + a])

  testStreamPurity(Stream.range(1, 5).mapAccum<number, number>(0, (s, a) => [s + a, s]))
})

function mapAccum<A, B, S>(array: A[], zero: S, f: (s: S, a: A) => [S, B]) {
  function loop(i: number, s: S): B[] {
    if (i < array.length) {
      const [s2, b] = f(s, array[i])
      return [b, ...loop(i + 1, s2)]
    } else {
      return []
    }
  }
  return loop(0, zero)
}

describe('zipWithIndex', () => {
  withFlowProp(<A>() => [(s: Stream<A>) => s.zipWithIndex(), (as: A[]) => _.zip(as, _.range(0, as.length))])
    .testStreams()

  testStreamPurity(Stream.range(1, 5).mapConcat((a: number) => [a, a + 2, a - 3]))
})

describe('intersperse', () => {
  foreachStreams((name, stream) => {
    test(name, async () => {
      const expected = await stream.toArray().then(as => as.join(','))
      const actual = await stream.intersperse(',').toArray().then(as => as.join(''))
      expect(actual).toEqual(expected)
    })
  })

  testStreamPurity(Stream.range(1, 5).intersperse('_'))
})

describe('mapAsync', () => {
  withFlowProp(<A>(f: (a: A) => any) => [
    (s: Stream<A>) => s.mapAsync((a: A) => Promise.resolve(f(a))),
    (a: A[]) => a.map(f),
  ]).testStreams((a: number) => a + 1)

  testStreamPurity(Stream.range(1, 5).mapAsync(n => Promise.resolve(n + 1)))

  test('with delay', async () => {
    const events: string[] = []
    const array = [1, 2, 3, 4]
    const result = await Stream
      .from(array)
      .mapAsync(async a => {
        events.push('in' + a)
        await delay(100)
        events.push('out' + a)
        return a
      }, 1)
      .toArray()
    expect(result).toEqual(array)
    expect(events).toEqual(['in1', 'out1', 'in2', 'out2', 'in3', 'out3', 'in4', 'out4'])
  })

  for (const par of [1, 2]) {
    test(`parallelism ${par}`, async () => {
      let concurrent: number = 0
      const events: number[] = []
      const array = [1, 2, 3, 4, 5]
      const result = await Stream.from(array)
        .mapAsync(async a => {
          concurrent++
          events.push(concurrent)
          await delay(100)
          concurrent--
          return a
        }, par)
        .toArray()
      expect(result).toEqual(array)
      expect(_.max(events)).toEqual(par)
    })
  }

  test('ordering', async () => {
    const result = await Stream.from([3, 2, 1])
      .mapAsync(async a => {
        await delay(50 * a)
        return a
      }, 3)
      .toArray()
    expect(result).toEqual([3, 2, 1])
  })

  test('parallelism and early finish', async () => {
    let count: number = 0
    const result = await Stream
      .range(1, 5)
      .mapAsync(async a => {
        count++
        await delay(100)
        return a
      }, 2)
      .take(2)
      .toArray()
    expect(result).toEqual([1, 2])
    expect(count).toBeLessThan(4)
  })

  test('with failure', async () => {
    const result = await Stream.range(1, 5)
      .mapAsync(n => n === 3 ? Promise.reject('my error') : Promise.resolve(n))
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 2, 'my error'])
  })

  test('with upstream failure', async () => {
    const result = await Stream.range(1, 2).concat(Stream.failed<number>('my error'))
      .mapAsync(async n => n + 1)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([2, 3, 'my error'])
  })
})

describe('mapAsyncUnordered', () => {
  withFlowProp(<A>(f: (a: A) => any) => [
    (s: Stream<A>) => s.mapAsyncUnordered((a: A) => Promise.resolve(f(a)), 1),
    (a: A[]) => a.map(f),
  ]).testStreams((a: number) => a + 1)

  testStreamPurity(Stream.range(1, 5).mapAsyncUnordered(n => Promise.resolve(n + 1), 1))

  test('with delay', async () => {
    const events: string[] = []
    const array = [1, 2, 3, 4]
    const result = await Stream
      .from(array)
      .mapAsyncUnordered(async a => {
        events.push('in' + a)
        await delay(100)
        events.push('out' + a)
        return a
      }, 1)
      .toArray()
    expect(result).toEqual(array)
    expect(events).toEqual(['in1', 'out1', 'in2', 'out2', 'in3', 'out3', 'in4', 'out4'])
  })

  for (const par of [1, 2]) {
    test(`parallelism ${par}`, async () => {
      let concurrent: number = 0
      const events: number[] = []
      const array = [1, 2, 3, 4, 5]
      const result = await Stream.from(array)
        .mapAsyncUnordered(async a => {
          concurrent++
          events.push(concurrent)
          await delay(100)
          concurrent--
          return a
        }, par)
        .toArray()
      expect(result).toEqual(array)
      expect(_.max(events)).toEqual(par)
    })
  }

  test('unordering', async () => {
    const result = await Stream.from([3, 2, 1])
      .mapAsyncUnordered(async a => {
        await delay(50 * a)
        return a
      }, 3)
      .toArray()
    expect(result).toEqual([1, 2, 3])
  })

  test('parallelism and early finish', async () => {
    let count: number = 0
    const result = await Stream
      .range(1, 5)
      .mapAsyncUnordered(async a => {
        count++
        await delay(100)
        return a
      }, 2)
      .take(2)
      .toArray()
    expect(result).toEqual([1, 2])
    expect(count).toBeLessThan(4)
  })

  test('with failure', async () => {
    const result = await Stream.range(1, 5)
      .mapAsyncUnordered(n => n === 3 ? Promise.reject('my error') : Promise.resolve(n), 1)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 2, 'my error'])
  })

  test('with upstream failure', async () => {
    const result = await Stream.range(1, 2).concat(Stream.failed<number>('my error'))
      .mapAsyncUnordered(async n => n + 1, 2)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([2, 3, 'my error'])
  })
})

describe('concat', () => {
  foreachStreams((name1, stream1) => {
    foreachStreams((name2, stream2) => {
      test(`${name1} - ${name2}`, async () => {
        const left = await stream1.toArray()
        const right = await stream2.toArray()
        const actual = await stream1.concat(stream2).toArray()
        expect(actual).toEqual(left.concat(right))
      })
    })
  })

  testStreamPurity(Stream.range(1, 3).concat(Stream.from([4, 5])))

  test('with early stop', async () => {
    const result = await Stream.range(1, 3).concat(Stream.range(4, 5)).take(2).toArray()
    expect(result).toEqual([1, 2])
  })

  test('with failure', async () => {
    const result = await Stream.range(1, 2)
      .concat(Stream.failed('my error'))
      .concat(Stream.range(3, 4))
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 2, 'my error'])
  })
})

describe('zipAllWith', () => {
  test('left shorter', async () => {
    const result = await Stream.from(['foo', 'bar', 'baz'])
      .zipAllWith(Stream.range(1, 2), (a, b) => (a || '') + (b || ''))
      .toArray()
    expect(result).toEqual(['foo1', 'bar2', 'baz'])
  })
  test('right shorter', async () => {
    const result = await Stream.from(['foo', 'bar'])
      .zipAllWith(Stream.range(1, 3), (a, b) => (a || '') + (b || ''))
      .toArray()
    expect(result).toEqual(['foo1', 'bar2', '3'])
  })
})

describe('zipWith', () => {
  test('same length', async () => {
    const result = await Stream.range(1, 3)
      .zipWith(Stream.from([4, 5, 6]), (a, b) => a + b)
      .toArray()
    expect(result).toEqual([5, 7, 9])
  })
  test('left shorter', async () => {
    const result = await Stream.range(1, 3)
      .zipWith(Stream.range(4, 7), (a, b) => a + b)
      .toArray()
    expect(result).toEqual([5, 7, 9])
  })
  test('right shorter', async () => {
    const result = await Stream.range(1, 4)
      .zipWith(Stream.range(4, 6), (a, b) => a + b)
      .toArray()
    expect(result).toEqual([5, 7, 9])
  })
  test('with slow left input', async () => {
    const result = await delayedArray([1, 2, 3], 20)
      .zipWith(Stream.range(4, 6), (a, b) => a + b)
      .toArray()
    expect(result).toEqual([5, 7, 9])
  })
  test('with slow right input', async () => {
    const result = await Stream.range(1, 3)
      .zipWith(delayedArray([4, 5, 6], 20), (a, b) => a + b)
      .toArray()
    expect(result).toEqual([5, 7, 9])
  })
  test('left error', async () => {
    const result = await Stream.single(1).concat(Stream.failed<number>('my error'))
      .zipWith(Stream.range(2, 4), (a, b) => a + b)
      .recover(err => err)
      .toArray()
    expect(result).toEqual([3, 'my error'])
  })
  test('right error', async () => {
    const result = await Stream.range(1, 3)
      .zipWith(Stream.single(4).concat(Stream.failed<number>('my error')), (a, b) => a + b)
      .recover(err => err)
      .toArray()
    expect(result).toEqual([5, 'my error'])
  })
  testStreamPurity(Stream.range(1, 3).merge(Stream.range(11, 13)))
})

describe('zip', () => {
  foreachStreams((name1, left) => {
    foreachStreams((name2, right) => {
      test(`${name1} - ${name2}`, async () => {
        const leftArray = await left.toArray()
        const rightArray = await right.toArray()
        const length = Math.min(leftArray.length, rightArray.length)

        const result = await left.zip(right).toArray()
        expect(result).toEqual(_.zip(leftArray.slice(0, length), rightArray.slice(0, length)))
      })
    })
  })
})

describe('merge', () => {
  test('interleave when sync - right end first', async () => {
    const result = await Stream.range(1, 5).merge(Stream.range(11, 13)).toArray()
    expect(result).toEqual([1, 11, 2, 12, 3, 13, 4, 5])
  })
  test('interleave with 3 streams', async () => {
    const result = await Stream.merge(
      Stream.range(1, 5),
      Stream.range(11, 15),
      Stream.range(21, 25),
    ).toArray()
    expect(result).toEqual([1, 11, 21, 2, 12, 22, 3, 13, 23, 4, 14, 24, 5, 15, 25])
  })
  test('interleave when sync - left end first', async () => {
    const result = await Stream.range(1, 3).merge(Stream.range(11, 15)).toArray()
    expect(result).toEqual([1, 11, 2, 12, 3, 13, 14, 15])
  })
  test('with early end', async () => {
    const result = await Stream.range(1, 5).merge(Stream.range(11, 13)).take(3).toArray()
    expect(result).toEqual([1, 11, 2])
  })
  test('with early end when only left is still open', async () => {
    const result = await Stream.range(1, 5).merge(Stream.empty()).take(3).toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with early end when only right is still open', async () => {
    const result = await Stream.empty().merge(Stream.range(1, 5)).take(3).toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with delay - right end first', async () => {
    const result = await delayedArray([1, 3], 100).merge(delayedArray([2], 150)).take(3).toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with delay - left end first', async () => {
    const result = await delayedArray([2], 150).merge(delayedArray([1, 3], 100)).take(3).toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with delayed end - left end last', async () => {
    const result = await Stream.fromAsyncIterator(async function*() {
      yield 1
      await delay(50)
    }).merge(Stream.empty()).toArray()
    expect(result).toEqual([1])
  })
  test('with delayed end - right end last', async () => {
    const result = await Stream.empty().merge(Stream.fromAsyncIterator(async function*() {
      yield 1
      await delay(50)
    })).toArray()
    expect(result).toEqual([1])
  })
  test('left error', async () => {
    const result = await Stream.failed('my error').merge(Stream.range(1, 3)).recover(err => err).toArray()
    expect(result).toEqual(result.length > 1 ? [1, 'my error'] : ['my error'])
  })
  test('right error', async () => {
    const result = await Stream.range(1, 3).merge(Stream.failed('my error')).recover(err => err).toArray()
    expect(result).toEqual(result.length > 1 ? [1, 'my error'] : ['my error'])
  })
  testStreamPurity(Stream.range(1, 3).merge(Stream.range(11, 13)))
})

describe('recover', () => {
  test('simple', async () => {
    const result = await Stream.range(1, 3)
      .concat(Stream.failed('my error'))
      .recover(err => err === 'my error' ? 4 : 0)
      .toArray()
    expect(result).toEqual([1, 2, 3, 4])
  })
})
