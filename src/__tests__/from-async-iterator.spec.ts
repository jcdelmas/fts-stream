import { Stream } from '../stream'
import { delay } from '../helpers'

describe('fromAsyncIterator', () => {
  test('simple', async () => {
    const result = await Stream.fromAsyncIterator(asyncIt).toArray()
    expect(result).toEqual([1, 2, 3])
  })
  test('with cancel', async () => {
    const it = closeableAsyncIt()
    const result = await Stream.fromAsyncIterator(() => it)
      .take(1)
      .toArray()
    expect(result).toEqual([0])
    expect(it.closed).toBe(true)
  })
})

async function* asyncIt() {
  yield 1
  await delay(1)
  yield 2
  await delay(1)
  yield 3
}

function closeableAsyncIt(): AsyncIterator<number> & { closed: boolean } {
  let i = 0
  return {
    closed: false,
    async next() {
      if (i < 3) {
        return { value: i++ }
      } else {
        return { done: true, value: undefined }
      }
    },
    async return() {
      this.closed = true
      return { done: true, value: undefined }
    },
  }
}
