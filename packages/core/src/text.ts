import { Pipe, Stream } from './stream'

export const lines: Pipe<string, string> = (stream: Stream<string>) =>
  Stream.fromAsyncIterator(() => doLines(stream))

async function* doLines(stream: Stream<string>): AsyncIterator<string> {
  let acc: string[] = []
  let prevIsCR = false
  for await (const s of stream) {
    const len = s.length
    let offset = 0
    for (let i = 0; i < len; i++) {
      const c = s.charAt(i)
      if (c === '\r') {
        yield [...acc, s.slice(offset, i)].join('')
        acc = []
        prevIsCR = true
        offset = i + 1
      } else if (c === '\n') {
        if (prevIsCR) {
          prevIsCR = false
        } else {
          yield [...acc, s.slice(offset, i)].join('')
          acc = []
        }
        offset = i + 1
      } else if (prevIsCR) {
        prevIsCR = false
      }
    }
    if (offset < len) {
      acc.push(s.slice(offset))
    }
  }
  yield acc.join('')
}
