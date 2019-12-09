import { Stream } from '../stream'

describe('recoverWith', () => {
  test('simple', async () => {
    const result = await Stream.range(1, 4)
      .concat(Stream.failed('my error'))
      .recoverWithRetries(1, err =>
        err === 'my error' ? Stream.range(4, 7) : Stream.empty<number>(),
      )
      .toArray()
    expect(result).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('without error', async () => {
    const result = await Stream.range(1, 4)
      .recoverWithRetries(1, err =>
        err === 'my error' ? Stream.range(4, 7) : Stream.empty<number>(),
      )
      .toArray()
    expect(result).toEqual([1, 2, 3])
  })

  test('with several retries', async () => {
    const result = await Stream.range(1, 4)
      .concat(Stream.failed('error 1'))
      .recoverWithRetries(2, err => {
        if (err === 'error 1') {
          return Stream.single(4).concat(Stream.failed('error 2'))
        } else {
          return Stream.single(5)
        }
      })
      .toArray()
    expect(result).toEqual([1, 2, 3, 4, 5])
  })
})
