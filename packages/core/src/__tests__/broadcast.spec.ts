import { Stream } from '../stream'
import { testCancellation } from './helpers'

describe('broadcast to', () => {
  test('simple', async () => {
    const first: number[] = []
    const second: number[] = []
    await Stream.range(1, 4).broadcastTo(
      s => s.map((x: number) => x + 1).foreach((x: number) => first.push(x)),
      s => s.map((x: number) => x + 2).foreach((x: number) => second.push(x)),
    )
    expect(first).toEqual([2, 3, 4])
    expect(second).toEqual([3, 4, 5])
  })
  test('with cancel', async () => {
    const first: number[] = []
    const second: number[] = []
    await Stream.range(1, 4).broadcastTo(
      s => s.take(2).foreach((x: number) => first.push(x)),
      s => s.map((x: number) => x + 1).foreach((x: number) => second.push(x)),
    )
    expect(first).toEqual([1, 2])
    expect(second).toEqual([2, 3, 4])
  })
  test('with full cancel', async () => {
    const first: number[] = []
    const second: number[] = []
    await Stream.range(1, 6).broadcastTo(
      s => s.take(2).foreach((x: number) => first.push(x)),
      s =>
        s
          .take(4)
          .map((x: number) => x + 1)
          .foreach((x: number) => second.push(x)),
    )
    expect(first).toEqual([1, 2])
    expect(second).toEqual([2, 3, 4, 5])
  })
  test('with upstream error', async () => {
    const first: number[] = []
    const second: number[] = []
    const result = Stream.range(1, 3)
      .concat(Stream.failed<number>(new Error('My error')))
      .broadcastTo(
        (s: Stream<number>) => s.foreach(x => first.push(x)),
        (s: Stream<number>) => s.foreach(x => second.push(x)),
      )
    await expect(result).rejects.toEqual(new Error('My error'))
    expect(first).toEqual([1, 2])
    expect(second).toEqual([1, 2])
  })
  test('with error in a sink', async () => {
    const first: number[] = []
    const second: number[] = []
    const result = Stream.range(1, 3).broadcastTo(
      (s: Stream<number>) => s.foreach(x => first.push(x)),
      async (s: Stream<number>) => {
        for await (const a of s) {
          second.push(a)
          throw new Error('My error')
        }
      },
    )
    await expect(result).rejects.toEqual(new Error('My error'))
    expect(first).toEqual([1])
    expect(second).toEqual([1])
  })
})

describe('broadcast through', () => {
  test('simple', async () => {
    const result = await Stream.range(1, 4)
      .broadcastThrough(s => s.map((x: number) => x - 1), s => s.map((x: number) => x + 2))
      .toArray()
    expect(result.sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
  test('with cancel in a branch', async () => {
    const result = await Stream.range(1, 5)
      .broadcastThrough(s => s.take(2), s => s.drop(2))
      .toArray()
    expect(result).toEqual([1, 2, 3, 4])
  })
  test('with cancel in all branch', async () => {
    const result = await Stream.range(1, 6)
      .broadcastThrough(s => s.take(2), s => s.drop(2).take(1))
      .toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with cancel after merge', async () => {
    const result = await Stream.range(1, 4)
      .broadcastThrough(
        (s: Stream<number>) => s.map(x => x - 1),
        (s: Stream<number>) => s.map(x => x + 1),
      )
      .take(4)
      .toArray()
    expect(result.sort()).toEqual([0, 1, 2, 3])
  })
  test('back pressure', async () => {
    const result = await Stream.range(1, 5)
      .broadcastThrough(
        (s: Stream<number>) => s.map(a => -a).throttle(50),
        (s: Stream<number>) => s,
      )
      .toArray()
    expect(result).toEqual([1, -1, 2, -2, 3, -3, 4, -4])
  })
  test('with upstream error', async () => {
    const result = await Stream.range(1, 3)
      .concat(Stream.failed<number>('My error'))
      .broadcastThrough((s: Stream<number>) => s, (s: Stream<number>) => s)
      .recover(err => err.toString())
      .toArray()
    expect(result).toEqual([1, 1, 2, 2, 'My error'])
  })
  test('with error in a pipe', async () => {
    const result = await Stream.range(1, 3)
      .broadcastThrough(
        (s: Stream<number>) => s,
        (s: Stream<number>) =>
          s.mapAsync(a => (a === 1 ? Promise.resolve(1) : Promise.reject('My error'))),
      )
      .recover(err => err.toString())
      .toArray()
    expect(result).toEqual([1, 1, 2, 'My error'])
  })
  test('purity', async () => {
    const stream = Stream.range(1, 3).broadcastThrough(
      (s: Stream<number>) => s,
      (s: Stream<number>) => s,
    )
    const run1 = stream.toArray()
    const run2 = stream.toArray()
    const result1 = await run1
    const result2 = await run2
    expect(result1).toEqual([1, 1, 2, 2])
    expect(result2).toEqual([1, 1, 2, 2])
  })

  testCancellation(s => s.broadcastThrough(s => s.map(x => x + 1), s => s.map(x => x + 2)))
})
