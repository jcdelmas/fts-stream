export class Consumer<A, R, AA = A> {
  constructor(public iteratee: () => Consumer.Iteratee<A, R, AA>) {}

  mapResult<R2>(f: (r: R) => R2): Consumer<A, R2, AA> {
    return new Consumer(() => {
      const it = this.iteratee()
      return {
        next(a: A) {
          const resp = it.next(a)
          return resp && { result: f(resp.result), remaining: resp.remaining }
        },
        done() {
          return f(it.done())
        },
      }
    })
  }
}

export function continuousIteratee<A, R>(
  consumer: Consumer<A, R>,
): { next: (a: A) => R[]; done: () => R } {
  let iteratee = consumer.iteratee()
  const next = (a: A): R[] => {
    const resp = iteratee.next(a)
    if (resp) {
      iteratee = consumer.iteratee()
      return [resp.result, ...resp.remaining.flatMap(a => next(a) || [])]
    } else {
      return []
    }
  }
  return { next, done: () => iteratee.done() }
}

export namespace Consumer {
  export type Iteratee<A, R, AA> = {
    next: (a: A) => Result<AA, R> | undefined
    done: () => R
  }

  export type Result<A, R> = { result: R; remaining: A[] }

  export function head<A>(): Consumer<A, A | undefined> {
    return new Consumer(() => ({
      next(a: A) {
        return { result: a, remaining: [] }
      },
      done() {
        return undefined
      },
    }))
  }

  export function take<A>(n: number): Consumer<A, A[]> {
    if (n < 1) throw new Error('n must be greater than or equal to 1')
    return new Consumer<A, A[]>(() => {
      let i = n
      const acc: A[] = []
      return {
        next(a: A) {
          acc.push(a)
          i--
          return i === 0 ? { result: acc, remaining: [] } : undefined
        },
        done() {
          return acc
        },
      }
    })
  }

  export function takeWhile<A>(f: (a: A) => boolean): Consumer<A, A[]> {
    return new Consumer<A, A[]>(() => {
      const acc: A[] = []
      return {
        next(a: A) {
          if (f(a)) {
            acc.push(a)
          } else {
            return { result: acc, remaining: [a] }
          }
        },
        done() {
          return acc
        },
      }
    })
  }

  // export function chain<A, R1, R2>(c1: Consumer<A, R1>, c2: Consumer<A, R2>): Consumer<A, [R1, R2]>
  // export function chain<A, R1, R2, R3>(
  //   c1: Consumer<A, R1>,
  //   c2: Consumer<A, R2>,
  //   c3: Consumer<A, R3>,
  // ): Consumer<A, [R1, R2, R3]>
  // export function chain<A, R1, R2, R3, R4>(
  //   c1: Consumer<A, R1>,
  //   c2: Consumer<A, R2>,
  //   c3: Consumer<A, R3>,
  //   c4: Consumer<A, R4>,
  // ): Consumer<A, [R1, R2, R3, R4]>

  // export function chain<A>(...consumers: Consumer<A, any>[]): Consumer<A, any[]> {
  //   return new Consumer(() => {
  //     const iteratees = consumers.map(c => c.iteratee())
  //     let idx: number = 0
  //     const len = iteratees.length
  //     return (a: A) => {
  //       let resp = iteratees[idx](a)
  //       while (resp) {
  //         idx++
  //         if (idx < len) {
  //           resp = iteratees[idx](resp.remaining)
  //         } else {
  //           return resp
  //         }
  //       }
  //     }
  //   })
  // }
}
