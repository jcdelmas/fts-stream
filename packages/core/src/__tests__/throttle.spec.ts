import { Stream } from '../stream'
import { testStreamPurity, testCancellation } from './helpers'
import { checkTime, TimedStream } from './utils'

describe('throttle', () => {
  it('simple', async () => {
    const startTime = new Date().getTime()
    const result = await Stream.repeat(1)
      .throttle(100)
      .take(4)
      .map(() => new Date().getTime() - startTime)
      .toArray()
    expect(result).toHaveLength(4)
    result.forEach((time, i) => checkTime(time, i * 100))
  })
  it('with elements > 1', async () => {
    const startTime = new Date().getTime()
    const result = await Stream.repeat(1)
      .take(4)
      .throttle(200, { elements: 2 })
      .map(() => new Date().getTime() - startTime)
      .toArray()
    expect(result).toHaveLength(4)
    checkTime(result[0], 0)
    checkTime(result[1], 0)
    checkTime(result[2], 200)
    checkTime(result[3], 200)
  })
  it('with maximumBurst', async () => {
    const startTime = new Date().getTime()
    const result = await TimedStream.of([[0, 1], [0, 2], [450, 3], [0, 4], [0, 5], [0, 6]])
      .throttle(100, { maximumBurst: 2 })
      .map(() => new Date().getTime() - startTime)
      .toArray()

    expect(result).toHaveLength(6)
    checkTime(result[0], 0)
    checkTime(result[1], 100) // The bucket is initialized with 1 element (not maximumBurst)
    checkTime(result[2], 450)
    checkTime(result[3], 450)
    checkTime(result[4], 500)
    checkTime(result[5], 600)
  })
  it('with cost calculation', async () => {
    const startTime = new Date().getTime()
    const result = await Stream.from([1, 2, 4, 2, 2, 2])
      .throttle(100, { cost: 3, maximumBurst: 6, costCalculation: x => x })
      .map(() => new Date().getTime() - startTime)
      .toArray()
    expect(result).toHaveLength(6)
    checkTime(result[0], 0)
    checkTime(result[1], 0)
    checkTime(result[2], 200)
    checkTime(result[3], 200)
    checkTime(result[4], 300)
    checkTime(result[5], 400)
  })
  it('with cost higher than maximum burst', async () => {
    const startTime = new Date().getTime()
    const result = await Stream.from(['a', 'ab', 'abc'])
      .throttle(100, { costCalculation: x => x.length })
      .map(() => new Date().getTime() - startTime)
      .toArray()
    expect(result).toHaveLength(3)
    checkTime(result[0], 0)
    checkTime(result[1], 200)
    checkTime(result[2], 500)
  })
  it('with failOnPressure', async () => {
    const promise = TimedStream.of([[0, 1], [100, 2], [0, 3]])
      .throttle(100, { failOnPressure: true })
      .toArray()

    await expect(promise).rejects.toEqual(new Error('Maximum throttle throughput exceeded.'))
  })
  test('upstream failure', async () => {
    const result = await Stream.range(1, 3)
      .concat(Stream.failed<number>('my error'))
      .throttle(5)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 2, 'my error'])
  })

  testCancellation(s => s.throttle(50))

  testStreamPurity(Stream.range(1, 6).throttle(5))
})
