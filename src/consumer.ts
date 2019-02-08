import { P } from './stream'
import { Chunk } from './chunk'

export interface Consumer<A, R, S> {
  initial: S
  update(s: S, a: Chunk<A>): P<S>
  cont(s: S): boolean
  result(s: S): P<R>
  remaining(s: S): Chunk<A>
}

// type ConsumerProps<A, R, State> = {
//   initial: State,
//   update: (s: State, a: Chunk<A>) => P<State>,
//   cont: (s: State) => boolean,
//   result: (s: State) => P<R>,
//   remaining: (s: State) => Chunk<A>,
// }
//
// class ConsumerImpl<A, R, State> extends Consumer<A, R, State> {
//   constructor(props: ConsumerProps<A, R, State>) {
//     super()
//     this.initial = props.initial
//     this.update = props.update
//     this.cont = props.cont
//     this.result = props.result
//     this.remaining = props.remaining
//   }
// }

// namespace Consumer {
//   export function create<A, R, State>(props: ConsumerProps<A, R, State>) {
//     return new ConsumerImpl(props)
//   }
// }
