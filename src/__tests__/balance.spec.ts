import { Stream } from '../stream'
import { delayedPipe, testCancellation } from './helpers'

describe('balance through', () => {
  const DELAY = 50
  test('simple', async () => {
    const result = await Stream.range(1, 4)
      .balanceThrough(
        (s: Stream<number>) => s.pipe(delayedPipe<number>(DELAY)).map(x => 'A' + x),
        (s: Stream<number>) => s.pipe(delayedPipe<number>(DELAY)).map(x => 'B' + x),
      )
      .toArray()
    expect(result).toEqual(['A1', 'B2', 'A3', 'B4'])
  })
  test('with early cancel', async () => {
    const result = await Stream.range(1, 4)
      .throttle(10)
      .balanceThrough(
        (s: Stream<number>) =>
          s
            .take(1)
            .pipe(delayedPipe<number>(DELAY))
            .map(x => 'A' + x),
        (s: Stream<number>) => s.pipe(delayedPipe<number>(DELAY)).map(x => 'B' + x),
      )
      .toArray()
    expect(result).toEqual(['A1', 'B2', 'B3', 'B4'])
  })
  test('with full early cancel', async () => {
    const result = await Stream.range(1, 6)
      .throttle(10)
      .balanceThrough(
        (s: Stream<number>) =>
          s
            .take(1)
            .pipe(delayedPipe<number>(DELAY))
            .map(x => 'A' + x),
        (s: Stream<number>) =>
          s
            .take(3)
            .pipe(delayedPipe<number>(DELAY))
            .map(x => 'B' + x),
      )
      .toArray()
    expect(result).toEqual(['A1', 'B2', 'B3', 'B4'])
  })

  testCancellation(s => s.balanceThrough(s => s.map(x => x + 1), s => s.map(x => x + 2)))
})
