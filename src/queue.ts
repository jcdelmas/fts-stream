import { promiseChannel } from './helpers'

export enum OverflowStrategy {
  SLIDING = 'SLIDING',
  DROPPING = 'DROPPING',
  FAIL = 'FAIL',
  BACK_PRESSURE = 'BACK_PRESSURE',
}

interface Pending<A> {
  value: A
  interrupt: () => void
}

export interface QueueReader<A> extends AsyncIterable<A> {
  take(): Promise<A | Interrupted>
}

export interface QueueWriter<A> {
  isClosed: boolean
  offer(a: A): Promise<boolean>
  offerIfNotClosed(a: A): Promise<boolean>
  onAvailable(): Promise<void>
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

  static create<A>(
    capacity: number,
    overflowStrategy: OverflowStrategy,
    onClose: (remaining: A[]) => void = () => {},
  ) {
    switch (overflowStrategy) {
      case OverflowStrategy.BACK_PRESSURE:
        return this.bounded<A>(capacity, onClose)
      case OverflowStrategy.SLIDING:
        return this.sliding<A>(capacity, onClose)
      case OverflowStrategy.DROPPING:
        return this.dropping<A>(capacity, onClose)
      case OverflowStrategy.FAIL:
        return this.failing<A>(capacity, onClose)
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

  private pendingProducers: Pending<A>[] = []
  private pendingConsumers: Pending<(a: A) => void>[] = []
  private pendingAvailable: (() => void)[] = []

  private constructor(
    private queue: NonBlockingQueue<A>,
    private overflowStrategy: OverflowStrategy,
    private onClose: (remaining: A[]) => void = () => {},
  ) {}

  async offer(a: A): Promise<boolean> {
    this.checkNotClosed()
    const pending = this.pendingConsumers.shift()
    if (pending !== undefined) {
      // The queue is empty and a pending consumer is waiting
      pending.value(a)
      return true
    } else if (this.queue.offer(a)) {
      return true
    } else {
      switch (this.overflowStrategy) {
        case OverflowStrategy.BACK_PRESSURE:
          const channel = promiseChannel<boolean>()
          this.pendingProducers.push({
            get value() {
              channel.resolve(true)
              return a
            },
            interrupt() {
              channel.resolve(false)
            },
          })
          return channel.promise
        case OverflowStrategy.FAIL:
          throw new Error('Too much pressure')
        default:
          return false
      }
    }
  }

  async offerIfNotClosed(a: A): Promise<boolean> {
    return !this.isClosed ? this.offer(a) : false
  }

  async onAvailable(): Promise<void> {
    if (!this.isClosed && this.queue.isFull && this.pendingConsumers.length === 0) {
      const channel = promiseChannel<void>()
      this.pendingAvailable.push(() => channel.resolve())
      return channel.promise
    }
  }

  mapInput<B>(f: (b: B) => A): QueueWriter<B> {
    const self = this
    return new (class {
      offer(b: B): Promise<boolean> {
        return self.offer(f(b))
      }
      async offerIfNotClosed(b: B): Promise<boolean> {
        if (!this.isClosed) {
          return this.offer(b)
        } else {
          return false
        }
      }
      async onAvailable(): Promise<void> {
        return self.onAvailable()
      }
      get isClosed(): boolean {
        return self.isClosed
      }
      mapInput<C>(f2: (c: C) => B): QueueWriter<C> {
        return mapQueueWrite(this, f2)
      }
    })()
  }

  async take(): Promise<A | Interrupted> {
    if (this.isClosed) return Interrupted
    const a = this.queue.take()
    if (a !== undefined) {
      // Free a pending producer if any
      const producer = this.pendingProducers.shift()
      if (producer !== undefined) this.queue.offer(producer.value)
      else this.notifyAvailable()
      return a
    } else {
      const producer = this.pendingProducers.shift()
      if (producer !== undefined) {
        return producer.value
      } else {
        const channel = promiseChannel<A | Interrupted>()
        this.pendingConsumers.push({
          value: (a: A) => channel.resolve(a),
          interrupt: () => channel.resolve(Interrupted),
        })
        this.notifyAvailable()
        return channel.promise
      }
    }
  }

  private notifyAvailable() {
    this.pendingAvailable.forEach(f => f())
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<A> {
    while (true) {
      const a = await this.take()
      if (a === Interrupted) break
      yield a as A
    }
  }

  close(): void {
    if (this.isClosed) {
      return
    }
    this.isClosed = true
    this.pendingConsumers.forEach(c => c.interrupt())
    this.onClose(this.drain())
    if (this.queue.size === 0) this.notifyAvailable()
  }

  drain(): A[] {
    const as = [...this.queue.drain(), ...this.pendingProducers.map(p => p.value)]
    this.pendingProducers = []
    if (this.queue.size > 0) this.notifyAvailable()
    return as
  }

  private checkNotClosed(): void {
    if (this.isClosed) throw new Error('Closed queue')
  }
}

function mapQueueWrite<A, B>(queue: QueueWriter<A>, f: (b: B) => A): QueueWriter<B> {
  return new (class {
    get isClosed() {
      return queue.isClosed
    }
    offer(b: B): Promise<boolean> {
      return queue.offer(f(b))
    }
    async offerIfNotClosed(b: B): Promise<boolean> {
      return !this.isClosed ? this.offer(b) : false
    }
    onAvailable() {
      return queue.onAvailable()
    }
    mapInput<C>(f2: (b: C) => B): QueueWriter<C> {
      return mapQueueWrite(this, f2)
    }
  })()
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

export interface Interrupted {
  __tag: 'interrupted'
}
export const Interrupted: Interrupted = { __tag: 'interrupted' }
