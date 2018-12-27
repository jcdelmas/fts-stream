import { Stream } from '../stream'
import { testStreamPurity, withStream } from './helpers'

describe('fromArray', () => {
  withStream(Stream.from)
    .test('empty', [], [])
    .test('basic', [1, 2, 3], [1, 2, 3])

  testStreamPurity(Stream.from([1, 2, 3]))
})

describe('range', () => {
  withStream(Stream.range)
    .test('empty', [], 1, 0)
    .test('one element', [1], 1, 1)
    .test('simple', [1, 2, 3], 1, 3)
    .test('special increment', [1, 3, 5], 1, 6, 2)
    .test('negative increment', [3, 2, 1], 3, 1, -1)

  testStreamPurity(Stream.range(1, 5))
})

describe('fromIterator', () => {
  withStream(Stream.fromIterator)
    .test('empty', [], function *() { if (false) return 1 })
    .test('simple', [1, 2, 3, 4], function *() {
      yield 1
      yield 2
      yield 3
      return 4
    })
    .test('without return', ['foo', 'bar'], function *() {
      yield 'foo'
      yield 'bar'
    })

  testStreamPurity(Stream.fromIterator(function *() {
    yield 1
    yield 2
    return 3
  }))
})

describe('fromPromise', () => {
  test('simple', async () => {
    const result = await Stream.fromPromise(() => Promise.resolve(3)).toArray()
    expect(result).toEqual([3])
  })
  testStreamPurity(Stream.fromPromise(() => Promise.resolve(5)))
})

describe('pipe', () => {
  test('simple', async () => {
    const result = await Stream.from([1, 2, 3]).pipe(s => s.map(x => x + 1)).toArray()
    expect(result).toEqual([2, 3, 4])
  })
})
