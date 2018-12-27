import { timeChecker, TimedStream, withTime } from './utils'
import { Stream } from '../stream'
import { testStreamPurity } from './helpers'

describe('debounce', () => {
  it('simple', async() => {
    const result = await TimedStream.of([
      [0, 1],
      [100, 2],
      [100, 3],
      [400, 4],
    ]).debounce(300).pipe(withTime()).toArray()
    timeChecker(result, [
      [3, 500],
      [4, 900]
    ])
  })

  it('with cancel', async() => {
    const result = await TimedStream.of([
      [0, 1],
      [0, 2],
      [200, 3],
      [200, 4]
    ]).debounce(100).take(2).pipe(withTime()).toArray()
    timeChecker(result, [
      [2, 100],
      [3, 300]
    ])
  })

  test('upstream failure', async () => {
    const result = await TimedStream.of([
      [0, 1],
      [100, 2]
    ]).concat(Stream.failed<number>('my error'))
      .debounce(50)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 'my error'])
  })

  testStreamPurity(TimedStream.of([[0, 1], [100, 2]]).debounce(50))
})
