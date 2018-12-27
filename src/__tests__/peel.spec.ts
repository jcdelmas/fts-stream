import { Consumer } from '../consumer'
import { Stream } from '../stream'

describe('peel', () => {

  test('chunked stream', async () => {
    const [h, ts] = await Stream.from([1, 2, 3, 4]).peel(takeConsumer(2))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4])
  })

  test('unchunked stream', async () => {
    const [h, ts] = await Stream.range(1, 4).peel(takeConsumer(2))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4])
  })

  test('chunked stream - early stop', async () => {
    const [h, ts] = await Stream.from([1, 2]).peel(takeConsumer(4))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([])
  })

  test('unchunked stream - early stop', async () => {
    const [h, ts] = await Stream.range(1, 2).peel(takeConsumer(4))
    const t = await ts.toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([])
  })

  test('with early error', async () => {
    expect.assertions(1)
    try {
      await Stream.range(1, 2).concat(Stream.failed(new Error('Coucou'))).peel(takeConsumer(4))
    } catch (e) {
      expect(e).toEqual(new Error('Coucou'))
    }
  })

  test('with late error', async () => {
    const [h, ts] = await Stream.from([1, 2, 3, 4]).concat(Stream.failed('Coucou')).peel(takeConsumer(2))
    const t = await ts.recover(e => e).toArray()
    expect(h).toEqual([1, 2])
    expect(t).toEqual([3, 4, 'Coucou'])
  })
})

type State<A> = [number, A[]]

function takeConsumer<A>(n: number): Consumer<A, A[], State<A>> {
  return Consumer.simple<A, A[], State<A>>({
    initial: [n, []],
    update([n2, acc]: State<A>, a: A): Consumer.Step<State<A>, A | undefined> {
      if (n2 === 0) return Consumer.Step.done<State<A>, A>([0, acc], a)
      if (n2 === 1) return Consumer.Step.done<State<A>, undefined>([0, [...acc, a]], undefined)
      return Consumer.Step.cont<State<A>>([n2 - 1, [...acc, a]])
    },
    result(s: State<A>): A[] {
      return s[1]
    },
  })
}
