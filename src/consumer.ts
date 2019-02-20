import { Chunk } from './chunk'
import { Maybe, P } from './helpers';

export class Consumer<A, R> {
  constructor(public iteratee: () => Iteratee<A, R>) {}
}

interface Iteratee<A, R> {
  update(a: Chunk<A>): P<Consumer.Cont | Chunk<A>>
  result(): P<R>
}

export interface SimpleIteratee<A, R> {
  update(a: A): Consumer.Cont | A | undefined
  result(): R
}

export namespace Consumer {
  export type Cont = { __tag: 'cont' }
  export const Cont: Cont = { __tag: 'cont' }

  export function simple<A, R>(factory: () => SimpleIteratee<A, R>): Consumer<A, R> {
    return new Consumer<A, R>(() => {
      const iteratee = factory()
      let chunkRemaining: Chunk<A> | undefined
      return {
        async update(as: Chunk<A>) {
          let i = 0
          for (const a of as) {
            const resp = await iteratee.update(a)
            i++
            if (resp !== Cont) {
              const base = as.drop(i)
              return resp !== undefined ? Chunk.singleton(resp as A).concat(base) : base
            }
          }
          return Cont
        },
        result() {
          return iteratee.result()
        }
      }
    })
  }

  export function head<A>(): Consumer<A, A | undefined> {
    return simple(() => {
      let last: A | undefined
      return {
        update(a: A): undefined {
          last = a
          return undefined
        },
        result(): A | undefined {
          return last
        }
      }
    })
  }

  export function take<A>(n: number): Consumer<A, A[]> {
    if (n < 1) throw new Error('n must be greater than or equal to 1')
    return simple<A, A[]>(() => {
      let i = n
      const acc: A[] = []
      return {
        update(a: A): Cont | undefined {
          acc.push(a)
          i-- 
          return i > 0 ? Cont : undefined
        },
        result(): A[] {
          return acc
        }
      }
    })
  }

  export function takeWhile<A>(pred: (a: A) => boolean): Consumer<A, A[]> {
    return simple<A, A[]>(() => {
      const acc: A[] = []
      return {
        update(a: A): Cont | A {
          if (pred(a)) {
            acc.push(a)
            return Cont
          }
          return a
        },
        result(): A[] {
          return acc
        }
      }
    })
  }
}
