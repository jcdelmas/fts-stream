export class Semaphore {

  current: number

  private pending: [number, () => void][] = []

  // TODO: add an option to forbid acquiring more than `max`
  constructor(readonly max: number, init?: number) {
    this.current = init !== undefined ? init : max
  }

  acquire(n: number = 1): Promise<void> {
    if (this.ask(n)) {
      return Promise.resolve()
    } else {
      return new Promise<void>(resolve => this.pending.push([n, resolve]))
    }
  }

  ask(n: number = 1): boolean {
    if (this.current >= n) {
      this.current = this.current - n
      return true
    } else {
      return false
    }
  }

  acquireAll(): Promise<void> {
    return this.acquire(this.max)
  }

  release(n: number = 1): void {
    const max = this.pending.length > 0 ? Math.max(this.pending[0][0], this.max) : this.max;
    this.current = Math.min(this.current + n, max)
    if (this.pending.length > 0) {
      const [take, resolve] = this.pending[0]
      if (take <= this.current) {
        this.pending.shift()
        this.current = this.current - take
        resolve()
      }
    }
  }

  releaseAll(): void {
    return this.release(this.max)
  }

  withLock<A>(f: () => Promise<A>, n: number = 1): Promise<A> {
    return this.acquire(n)
      .then(f)
      .finally(() => this.release(n))
  }
}
