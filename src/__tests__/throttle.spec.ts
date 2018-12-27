import { checkTime, TimedStream } from './utils'
import { Stream } from '../stream'
import { testStreamPurity } from './helpers'

describe('throttle', () => {
  it('simple', async () => {
    const startTime = new Date().getTime()
    const result = await Stream.repeat(1).throttle(100).take(4).map(() => new Date().getTime() - startTime).toArray()
    expect(result).toHaveLength(4)
    result.forEach((time, i) => checkTime(time, i * 100))
  })
  it('with elements > 1', async() => {
    const startTime = new Date().getTime();
    const result = await Stream.repeat(1).take(4)
      .throttle(200, { elements: 2 })
      .map(() => new Date().getTime() - startTime)
      .toArray()
    expect(result).toHaveLength(4)
    checkTime(result[0], 0)
    checkTime(result[1], 0)
    checkTime(result[2], 200)
    checkTime(result[3], 200)
  })
  it('with maximumBurst', async() => {
    const startTime = new Date().getTime()
    const result = await TimedStream.of([
      [0, 1],
      [100, 2],
      [300, 3],
      [0, 4],
      [0, 5],
      [0, 6]
    ])
      .throttle(100, { maximumBurst: 2 })
      .map(() => new Date().getTime() - startTime)
      .toArray()

    expect(result).toHaveLength(6)
    checkTime(result[0], 0)
    checkTime(result[1], 100)
    checkTime(result[2], 400)
    checkTime(result[3], 400)
    checkTime(result[4], 400)
    checkTime(result[5], 500)
  })
  it('with cost calculation', async() => {
    const startTime = new Date().getTime();
    const result = await Stream.from([
      1,
      2,
      4,
      2,
      2,
      2
    ])
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
  it('with failOnPressure', async () => {
    const promise = TimedStream.of([
      [0, 1],
      [100, 2],
      [0, 3]
    ])
      .throttle(100, { failOnPressure: true })
      .toArray()

    await expect(promise).rejects.toEqual(new Error('Maximum throttle throughput exceeded.'))
  })
  test('upstream failure', async () => {
    const result = await Stream.range(1, 2).concat(Stream.failed<number>('my error'))
      .throttle(5)
      .recover(r => r)
      .toArray()
    expect(result).toEqual([1, 2, 'my error'])
  })

  testStreamPurity(Stream.range(1, 5).throttle(5))
})
