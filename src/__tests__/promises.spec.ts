import { bracket } from '../promises'

describe('bracket', () => {
  test('success', async () => {
    const events: string[] = []
    const result = await bracket(
      async () => {
        events.push('use')
        return 'Hello World'
      },
      () => { events.push('release') },
    )
    expect(events).toEqual(['use', 'release'])
    expect(result).toEqual('Hello World')
  })
  test('with promise reject', async () => {
    expect.assertions(2)
    let closed = false
    try {
      await bracket(
        () => Promise.reject('My error'),
        () => { closed = true },
      )
    } catch (e) {
      expect(e).toEqual('My error')
      expect(closed).toBe(true)
    }
  })
  test('with error', async () => {
    expect.assertions(2)
    let closed = false
    try {
      await bracket(
        () => { throw new Error('My error') },
        () => { closed = true },
      )
    } catch (e) {
      expect(e).toEqual(new Error('My error'))
      expect(closed).toBe(true)
    }
  })
  test('with release error', async () => {
    expect.assertions(2)
    let msg = 'Hello'
    try {
      await bracket(
        async () => msg = msg + ' World',
        () => { throw new Error('My error') },
      )
    } catch (e) {
      expect(e).toEqual(new Error('My error'))
    }
    expect(msg).toEqual('Hello World')
  })
  test('with use and release error', async () => {
    expect.assertions(1)
    try {
      await bracket(
        () => Promise.reject(new Error('Use error')),
        () => { throw new Error('Release error') },
      )
    } catch (e) {
      expect(e).toEqual(new Error('Use error'))
    }
  })
})
