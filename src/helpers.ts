export async function swallowErrors(block: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await block()
  } catch (e) {
    console.error(e)
  }
}

export function delay(millis: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, millis)
  })
}

export async function safelyReturn<A>(iterator: AsyncIterator<A>) {
  return swallowErrors(() => iterator.return && iterator.return())
}

export interface PromiseChannel<A> {
  promise: Promise<A>
  closed: boolean
  resolve(a: A): void
  reject(err: any): void
}

export function promiseChannel<A>(): PromiseChannel<A> {
  return new (class {
    closed: boolean = false

    promise = new Promise<A>((resolve, reject) => {
      this.resolveChan = resolve
      this.rejectChan = reject
    })
    private resolveChan: ((a: A) => void) | undefined
    private rejectChan: ((err: any) => void) | undefined

    resolve(a: A): void {
      ;(this.resolveChan as (a: A) => void)(a)
      this.closed = true
    }

    reject(err: any): void {
      ;(this.rejectChan as (err: any) => void)(err)
      this.closed = true
    }
  })()
}
