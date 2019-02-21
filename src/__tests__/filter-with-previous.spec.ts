import { Stream } from "../stream";

describe('filterWithPrevious', () => {
  test('basic', async () => {
    const result = await Stream.from([1, -1, 0, 2, 1, 2, 3, 4]).filterWithPrevious((prev, current) => prev < current).toArray()
    expect(result).toEqual([1, 2, 3, 4])
  })
})
