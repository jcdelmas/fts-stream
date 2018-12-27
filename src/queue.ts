
export enum OverflowStrategy {
  SLIDING = 'SLIDING',
  DROPPING = 'DROPPING',
  FAIL = 'FAIL',
  BACK_PRESSURE = 'BACK_PRESSURE',
}

interface Pending<A> { resolve: (a: A) => void, interrupt: () => void }

export interface QueueReader<A> {
  take(): Promise<A>
}

export interface QueueWriter<A> {
  isClosed: boolean
  offer(a: A): Promise<void>
  offerIfNotClosed(a: A): Promise<void>
  mapInput<B>(f: (b: B) => A): QueueWriter<B>
}

export class Queue<A> implements QueueReader<A>, QueueWriter<A> {

  get size(): number {
    return this.queue.size
  }

  get isEmpty(): boolean {
    return this.size === 0
  }

  get isFull(): boolean {
    return this.queue.isFull
  }

  get hasPendingConsumers(): boolean {
    return this.pendingConsumers.length > 0
  }

  get hasPendingProducers(): boolean {
    return this.pendingProducers.length > 0
  }

  static create<A>(capacity: number, overflowStrategy: OverflowStrategy, onClose: (remaining: A[]) => void = () => {}) {
    switch (overflowStrategy) {
      case OverflowStrategy.BACK_PRESSURE: return this.bounded<A>(capacity, onClose)
      case OverflowStrategy.SLIDING      : return this.sliding<A>(capacity, onClose)
      case OverflowStrategy.DROPPING     : return this.dropping<A>(capacity, onClose)
      case OverflowStrategy.FAIL         : return this.failing<A>(capacity, onClose)
    }
  }

  static bounded<A>(capacity: number, onClose: (remaining: A[]) => void = () => {}): Queue<A> {
    return new Queue<A>(new BoundedQueue(capacity), OverflowStrategy.BACK_PRESSURE, onClose)
  }

  static sliding<A>(capacity: number, onClose: (remaining: A[]) => void = () => {}): Queue<A> {
    return new Queue<A>(new BoundedQueue(capacity, true), OverflowStrategy.SLIDING, onClose)
  }

  static dropping<A>(capacity: number, onClose: (remaining: A[]) => void = () => {}): Queue<A> {
    return new Queue<A>(new BoundedQueue(capacity), OverflowStrategy.DROPPING, onClose)
  }

  static failing<A>(capacity: number, onClose: (remaining: A[]) => void = () => {}): Queue<A> {
    return new Queue<A>(new BoundedQueue(capacity), OverflowStrategy.FAIL, onClose)
  }

  static unbounded<A>(onClose: (remaining: A[]) => void = () => {}): Queue<A> {
    return new Queue<A>(new UnboundedQueue<A>(), OverflowStrategy.FAIL, onClose)
  }

  isClosed = false

  private pendingProducers: Pending<(a: A) => void>[] = []
  private pendingConsumers: Pending<A>[] = []

  private constructor(
    private queue: NonBlockingQueue<A>,
    private overflowStrategy: OverflowStrategy,
    private onClose: (remaining: A[]) => void = () => {},
  ) {}

  offer(a: A): Promise<void> {
    return new Promise((resolve, reject) => {
      this.checkNotClosed(reject)
      const pending = this.pendingConsumers.shift()
      if (pending !== undefined) {
        // The queue is empty and a pending consumer is waiting
        pending.resolve(a)
        resolve()
      } else if (this.queue.offer(a)) {
        resolve()
      } else {
        switch (this.overflowStrategy) {
          case OverflowStrategy.BACK_PRESSURE:
            this.pendingProducers.push({
              resolve(consumer) {
                consumer(a)
                resolve()
              },
              interrupt() {
                reject(Interrupted)
              },
            })
            break
          case OverflowStrategy.FAIL:
            reject('Too much pressure')
            break
          default:
            resolve()
        }
      }
    })
  }

  async offerIfNotClosed(a: A): Promise<void> {
    if (!this.isClosed) {
      await this.offer(a)
    }
  }

  mapInput<B>(f: (b: B) => A): QueueWriter<B> {
    const self = this
    return new class {
      offer(b: B): Promise<void> {
        return self.offer(f(b))
      }
      async offerIfNotClosed(b: B): Promise<void> {
        if (!this.isClosed) {
          await this.offer(b)
        }
      }
      get isClosed(): boolean {
        return self.isClosed
      }
      mapInput<C>(f2: (c: C) => B): QueueWriter<C> {
        return mapQueueWrite(this, f2)
      }
    }
  }

  take(): Promise<A> {
    return new Promise<A>((resolve, reject) => {
      this.checkNotClosed(reject)
      const a = this.queue.take()
      if (a !== undefined) {
        resolve(a)
        // Free potential producers
        const producer = this.pendingProducers.shift()
        if (producer !== undefined) producer.resolve(a2 => this.queue.offer(a2))
      } else {
        const producer = this.pendingProducers.shift()
        if (producer !== undefined) {
          producer.resolve(resolve)
        } else {
          this.pendingConsumers.push({
            resolve,
            interrupt: () => reject(Interrupted),
          })
        }
      }
    })
  }

  close(): void {
    if (this.isClosed) {
      return
    }
    this.onClose(this.drain())
    for (const consumer of this.pendingConsumers) {
      consumer.interrupt()
    }
    this.isClosed = true
  }

  drain(): A[] {
    if (this.isClosed) {
      return []
    }
    const as = this.queue.drain()
    this.pendingProducers.forEach(producer => producer.resolve(a => as.push(a))) // Producers are always synchronous
    this.pendingProducers = []
    return as
  }

  private checkNotClosed(reject: (err: any) => void): void {
    if (this.isClosed) reject(new Error('Closed queue'))
  }
}

function mapQueueWrite<A, B>(queue: QueueWriter<A>, f: (b: B) => A): QueueWriter<B> {
  return new class {
    get isClosed() {
      return queue.isClosed
    }
    offer(b: B): Promise<void> {
      return queue.offer(f(b))
    }
    async offerIfNotClosed(b: B): Promise<void> {
      if (!this.isClosed) {
        await this.offer(b)
      }
    }
    mapInput<C>(f2: (b: C) => B): QueueWriter<C> {
      return mapQueueWrite(this, f2)
    }
  }
}

interface NonBlockingQueue<A> {
  isFull: boolean
  size: number
  offer(a: A): boolean
  take(): A | undefined
  drain(): A[]
  clear(): void
}

export class BoundedQueue<A> implements NonBlockingQueue<A> {

  get isFull(): boolean {
    return this.size === this.capacity
  }
  size: number = 0
  private buffer: A[] = new Array(this.capacity)
  private tail: number = 0
  private head: number = 0

  constructor(public capacity: number, private slidingPolicy: boolean = false) {}

  offer(a: A): boolean {
    if (this.size < this.capacity || this.slidingPolicy) {
      this.buffer[this.tail] = a
      this.tail = (this.tail + 1) % this.capacity
      this.size++
      return true
    } else {
      return false
    }
  }

  take(): A | undefined {
    if (this.size > 0) {
      const item = this.buffer[this.head]
      this.head = (this.head + 1) % this.capacity
      this.size--
      return item
    }
  }

  drain(): A[] {
    if (this.size > 0) {
      const h = this.head
      const t = this.tail
      this.size = 0
      this.head = 0
      this.tail = 0
      if (t > h) {
        return this.buffer.slice(this.head, this.tail)
      } else if (t === 0) {
        return this.buffer.slice(this.head)
      } else {
        return this.buffer.slice(this.head).concat(this.buffer.slice(0, this.tail))
      }
    } else {
      return []
    }
  }

  clear(): void {
    this.size = 0
    this.head = 0
    this.tail = 0
  }
}

class UnboundedQueue<A> implements NonBlockingQueue<A> {
  isFull: boolean = false
  size: number = 0
  private buffer: A[] = []

  clear(): void {
    this.buffer = []
    this.size = 0
  }

  drain(): A[] {
    const buf = this.buffer
    this.clear()
    return buf
  }

  offer(a: A): boolean {
    this.buffer.push(a)
    return true
  }

  take(): A | undefined {
    return this.buffer.shift()
  }
}

export interface Interrupted { __tag: 'interrupted' }
export const Interrupted: Interrupted = { __tag: 'interrupted' }
