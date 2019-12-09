import { Stream, Termination } from '../stream'
import { testStreamPurity, testCancellation } from './helpers'
import { timeChecker, TimedStream, withTime } from './utils'

describe('debounce', () => {
  test('simple', async () => {
    const result = await TimedStream.of([[0, 1], [100, 2], [100, 3], [400, 4]])
      .debounce(300)
      .pipe(withTime())
      .toArray()
    // expect(result).toEqual([3, 4])
    timeChecker(result, [[3, 500], [4, 900]])
  })

  test('with cancel', async () => {
    const listener: number[] = []
    const result = await TimedStream.of([[0, 1], [0, 2], [200, 3], [200, 4]])
      .tap(a => listener.push(a))
      .debounce(100)
      .take(2)
      .pipe(withTime())
      .toArray()
    timeChecker(result, [[2, 100], [3, 300]])
    expect(listener).toEqual([1, 2, 3])
  })

  test('upstream failure', async () => {
    const result = await TimedStream.of([[0, 1], [100, 2]])
      .concat(Stream.failed<number>('my error'))
      .debounce(50)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 'my error'])
  })

  testCancellation(s => s.throttle(100).debounce(50))

  testStreamPurity(TimedStream.of([[0, 1], [100, 2]]).debounce(50))
})
