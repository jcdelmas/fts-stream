import { Consumer } from './consumer'
import { Pipe, Stream } from './stream'

export const lines: Pipe<string, string> = (stream: Stream<string>) => stream.transduce(lineConsumer)

export const lineConsumer: Consumer<string, string> = Consumer.simple<string, string>(() => {
  let lastEndWithCR = false
  let acc: string[] = []
  return {
    update(str: string): Consumer.Cont | string {
      const len = str.length
      if (len === 0) {
        return Consumer.Cont
      }
  
      if (lastEndWithCR) {
        lastEndWithCR = false
        return str.charAt(0) === '\n' ? str.slice(1) : str
      }
  
      for (let i = 0; i < len; i++) {
        const c = str.charAt(i)
        if (c === '\r') {
          acc.push(str.slice(0, i))
          if (i < len - 1) {
            const nextStart = str.charAt(i + 1) === '\n' ? i + 2 : i + 1
            return str.slice(nextStart)
          } else {
            lastEndWithCR = true
            return Consumer.Cont
          }
        } else if (c === '\n') {
          acc.push(str.slice(0, i))
          return str.slice(i + 1)
        }
      }
      acc.push(str)
      return Consumer.Cont
    },
    result() {
      return acc.join('')
    },
  }
})
