import { Queue } from '../queue'

describe('Queue.bounded', () => {
  test('offer and take', async () => {
    const queue = Queue.bounded<number>(1)
    await queue.offer(1)
    const result = await queue.take()
    expect(result).toEqual(1)
  })
  test('pending offer', async () => {
    const queue = Queue.bounded<number>(1)
    await queue.offer(1)
    queue.offer(2)
    const r1 = await queue.take()
    const r2 = await queue.take()
    expect([r1, r2]).toEqual([1, 2])
  })
  test('pending offer with 0 capacity queue', async () => {
    const queue = Queue.bounded<number>(0)
    queue.offer(2)
    const result = await queue.take()
    expect(result).toEqual(2)
  })
  test('pending take', async () => {
    const queue = Queue.bounded<number>(0)
    const takeP = queue.take()
    await queue.offer(1)
    const result = await takeP
    expect(result).toEqual(1)
  })
  test('pending take with 0 capacity queue', async () => {
    const queue = Queue.bounded<number>(0)
    const takeP = queue.take()
    await queue.offer(1)
    const result = await takeP
    expect(result).toEqual(1)
  })
  test('back pressure', async () => {
    const events: string[] = []
    const queue = Queue.bounded<number>(1)
    await queue.offer(1).then(() => events.push('o1'))
    const offer2P = queue.offer(2).then(() => events.push('o2'))
    const offer3P = queue.offer(3).then(() => events.push('o3'))
    await queue.take().then(() => events.push('t1'))
    await queue.take().then(() => events.push('t2'))
    await queue.take().then(() => events.push('t3'))
    await offer2P
    await offer3P
    expect(events).toEqual(['o1', 'o2', 't1', 'o3', 't2', 't3'])
  })
  test('back pressure with 0 capacity queue', async () => {
    const events: string[] = []
    const queue = Queue.bounded<number>(0)
    const offer1P = queue.offer(1).then(() => events.push('o1'))
    const offer2P = queue.offer(2).then(() => events.push('o2'))
    await queue.take().then(() => events.push('t1'))
    await queue.take().then(() => events.push('t2'))
    await offer1P
    await offer2P
    expect(events).toEqual(['o1', 't1', 'o2', 't2'])
  })
  test('drain', () => {
    const queue = Queue.bounded<number>(2)
    queue.offer(1)
    queue.offer(2)
    queue.offer(3)
    queue.offer(4)
    const values = queue.drain()
    expect(values).toEqual([1, 2, 3, 4])
  })
  test('onClose', () => {
    let remaining: number[] = []
    const queue = Queue.bounded<number>(2, as => remaining = as)
    queue.offer(1)
    queue.offer(2)
    queue.offer(3)
    queue.offer(4)
    queue.close()
    expect(remaining).toEqual([1, 2, 3, 4])
  })
})
