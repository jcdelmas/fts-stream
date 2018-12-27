import { Chunk } from './chunk'
import { P } from './stream'

export interface Consumer<A, R, S> {
  initial: S
  update(s: S, a: Chunk<A>): P<Consumer.Step<S, Chunk<A>>>
  result(s: S): P<R>
}

export interface SimpleConsumer<A, R, S> {
  initial: S
  update(s: S, a: A): P<Consumer.Step<S, A | undefined>>
  result(s: S): P<R>
}

export namespace Consumer {
  export function simple<A, R, S>(consumer: SimpleConsumer<A, R, S>): Consumer<A, R, S> {
    return {
      initial: consumer.initial,
      async update(s: S, as: Chunk<A>) {
        let i = 0
        for (const a of as) {
          const step = await consumer.update(s, a)
          i++
          if (step.done) {
            const base = as.drop(i)
            const remaining = step.remaining !== undefined ? Chunk.singleton(step.remaining).concat(base) : base
            return Step.done(step.state, remaining)
          } else {
            s = step.state
          }
        }
        return Step.cont(s)
      },
      result(s: S): P<R> {
        return consumer.result(s)
      },
    }
  }

  export interface Cont<S> {
    done: false,
    state: S,
  }

  export interface Done<S, A> {
    done: true,
    state: S,
    remaining: A,
  }

  export type Step<S, A> = Cont<S> | Done<S, A>

  export namespace Step {
    export function cont<S>(state: S): Cont<S> {
      return { done: false, state }
    }
    export function done<S, A>(state: S, remaining: A): Done<S, A> {
      return { done: true, state, remaining }
    }
  }
}
