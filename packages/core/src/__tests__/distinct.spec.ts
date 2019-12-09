import _ from 'lodash'
import { Stream } from '../stream'
import { testStreamPurity, withFlowProp } from './helpers'

describe('distinct', () => {
  test('simple', async () => {
    const result = await Stream.from([1, 1, 1, 2, 1, 1, 3, 4, 4])
      .distinct()
      .toArray()
    expect(result).toEqual([1, 2, 1, 3, 4])
  })

  test('early stop', async () => {
    const result = await Stream.from([1, 1, 1, 2, 1, 1, 3, 4, 4])
      .distinct()
      .take(3)
      .toArray()
    expect(result).toEqual([1, 2, 1])
  })

  test('=== comparison', async () => {
    const result = await Stream.from([1, 1, '1', 1, 2, 0, false, false])
      .distinct()
      .toArray()
    expect(result).toEqual([1, '1', 1, 2, 0, false])
  })

  test('singleton', async () => {
    const result = await Stream.single(1)
      .distinct()
      .toArray()
    expect(result).toEqual([1])
  })

  test('empty', async () => {
    const result = await Stream.empty()
      .distinct()
      .toArray()
    expect(result).toEqual([])
  })
})
