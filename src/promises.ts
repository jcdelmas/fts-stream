export function bracket<A>(use: () => Promise<A>, release: () => void | Promise<void>): Promise<A> {
  return thrownToRejected(use).then(
    async a => {
      await release()
      return a
    },
    async err => {
      await swallowErrors(release)
      return Promise.reject(err)
    },
  )
}

export function thrownToRejected<A>(block: () => Promise<A>): Promise<A> {
  try {
    return block()
  } catch (e) {
    return Promise.reject(e)
  }
}

export async function swallowErrors<A>(block: () => void | Promise<void>): Promise<void> {
  try { await block() } catch (e) { console.error(e) }
}

export function delay(millis: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, millis)
  })
}

export function raceWith<A, B, C>(
  p1: Promise<A>,
  p2: Promise<B>,
  leftWin: (a: A) => C,
  rightWin: (b: B) => C,
): Promise<C> {
  return new Promise<C>((resolve, reject) => {
    let done = false
    p1.then(
      a => {
        if (!done) {
          done = true
          resolve(leftWin(a))
        }
      },
      err => {
        if (!done) {
          done = true
          reject(err)
        }
      },
    )
    p2.then(
      b => {
        if (!done) {
          done = true
          resolve(rightWin(b))
        }
      },
      err => {
        if (!done) {
          done = true
          reject(err)
        }
      },
    )
  })
}

export interface PromiseChannel<A> {
  promise: Promise<A>
  closed: boolean
  resolve(a: A): void
  reject(err: any): void
}

export function promiseChannel<A>(): PromiseChannel<A> {
  return new class {
    closed: boolean = false

    promise = new Promise<A>((resolve, reject) => {
      this.resolveChan = resolve
      this.rejectChan = reject
    })
    private resolveChan: ((a: A) => void) | undefined
    private rejectChan: ((err: any) => void) | undefined

    resolve(a: A): void {
      (this.resolveChan as (a: A) => void)(a)
      this.closed = true
    }

    reject(err: any): void {
      (this.rejectChan as (err: any) => void)(err)
      this.closed = true
    }
  }
}
