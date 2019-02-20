import { Consumer } from '../consumer'
import { Stream } from '../stream'

describe('peel', () => {

  test('chunked stream', async () => {
    const [h, ts] = await Stream.from([1, 2, 3, 4]).peel(Consumer.take(2))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4])
  })

  test('unchunked stream', async () => {
    const [h, ts] = await Stream.range(1, 4).peel(Consumer.take(2))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4])
  })

  test('chunked stream - early stop', async () => {
    const [h, ts] = await Stream.from([1, 2]).peel(Consumer.take(4))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([])
  })

  test('unchunked stream - early stop', async () => {
    const [h, ts] = await Stream.range(1, 2).peel(Consumer.take(4))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([])
  })

  test('with early error', async () => {
    expect.assertions(1)
    try {
      await Stream.range(1, 2).concat(Stream.failed(new Error('Coucou'))).peel(Consumer.take(4))
    } catch (e) {
      expect(e).toEqual(new Error('Coucou'))
    }
  })

  test('with late error', async () => {
    const [h, ts] = await Stream.from([1, 2, 3, 4]).concat(Stream.failed('Coucou')).peel(Consumer.take(2))
    const t = await ts.recover(e => e).toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4, 'Coucou'])
  })
})
