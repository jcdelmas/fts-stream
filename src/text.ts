import { Consumer } from './consumer'
import { Pipe, Stream } from './stream'

export const lines: Pipe<string, string> = (stream: Stream<string>) => stream.transduce(lineConsumer)

type State = [string[], boolean]

export const lineConsumer: Consumer<string, string, any> = Consumer.simple<string, string, State>({
  initial: [[], false],
  update([s, lastEndWithCR]: State, str: string): Consumer.Step<State, string> {
    const len = str.length
    if (len === 0) {
      return Consumer.Step.cont<State>([s, lastEndWithCR])
    }

    if (lastEndWithCR) {
      return Consumer.Step.done<State, string>([s, false], str.charAt(0) === '\n' ? str.slice(1) : str)
    }

    for (let i = 0; i < len; i++) {
      const c = str.charAt(i)
      if (c === '\r') {
        const state = [...s, str.slice(0, i)]
        if (i < len - 1) {
          const nextStart = str.charAt(i + 1) === '\n' ? i + 2 : i + 1
          return Consumer.Step.done<State, string>([state, false], str.slice(nextStart))
        } else {
          return Consumer.Step.cont<State>([state, true])
        }
      } else if (c === '\n') {
        const state = [...s, str.slice(0, i)]
        return Consumer.Step.done<State, string>([state, false], str.slice(i + 1))
      }
    }
    return Consumer.Step.cont<State>([[...s, str], false])
  },
  result(s: State) {
    return s[0].join('')
  },
})
