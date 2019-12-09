import { Consumer } from '../consumer'
import { Stream } from '../stream'

describe('peel', () => {
  // TODO: Missing test when no result is available

  test('simple', async () => {
    const result = await Stream.range(1, 5)
      .peel(Consumer.take(2), (head, tail) => tail.concat(Stream.from(head)))
      .toArray()
    expect(result).toEqual([3, 4, 1, 2])
  })

  test('early end', async () => {
    const result = await Stream.range(1, 3)
      .peel(Consumer.take(4), (head, tail) => tail.concat(Stream.from(head)))
      .toArray()
    expect(result).toEqual([1, 2])
  })

  test('with early error', async () => {
    expect.assertions(1)
    try {
      await Stream.range(1, 3)
        .concat(Stream.failed(new Error('Coucou')))
        .peel(Consumer.take(4), (head, tail) => Stream.from(head).concat(tail))
        .run()
    } catch (e) {
      expect(e).toEqual(new Error('Coucou'))
    }
  })

  test('with late error', async () => {
    const result = await Stream.from([1, 2, 3, 4])
      .concat(Stream.failed('Coucou'))
      .peel(Consumer.take(2), (head, tail) => Stream.from(head).concat(tail))
      .recover(e => e)
      .toArray()
    expect(result).toEqual([1, 2, 3, 4, 'Coucou'])
  })
})
