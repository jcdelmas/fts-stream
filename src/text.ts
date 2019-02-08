import { P, Pipe, Stream } from './stream'
import { Chunk } from './chunk'
import { Consumer } from './consumer'

export const lines: Pipe<string, string> = (stream: Stream<string>) => Stream.create(push => {
  let remaining: string[] = []
  let lastEndWithCR = false
  return stream.foreachChunks(async chunk => {
    const lineBuffer: string[] = []
    for (const str of chunk) {
      let start = 0
      let end = 0
      const len = str.length

      if (lastEndWithCR) {
        lastEndWithCR = false
        if (len > 0 && str.charAt(0) === '\n') {
          start = 1
          end = 1
        }
      }

      const pushChunk = (start: number, end: number) => {
        const line = str.slice(start, end)
        lineBuffer.push(start === 0 ? remaining.join('').concat(line) : line)
        remaining = []
      }

      while (end < len) {
        const c = str.charAt(end)
        if (c === '\r') {
          pushChunk(start, end)
          if (end < len - 1) {
            start = end = end + (str.charAt(end + 1) === '\n' ? 2 : 1)
          } else {
            lastEndWithCR = true
            start = end = end + 1
          }
        } else if (c === '\n') {
          pushChunk(start, end)
          start = end = end + 1
        } else {
          end++
        }
      }
      if (start < len) {
        remaining.push(str.slice(start))
      }
    }

    return push(Chunk.seq(lineBuffer))
  }).then(async cont => {
    return cont && remaining.length > 0 ? await push(Chunk.singleton(remaining.join(''))) : cont
  })
})


export const linesCons: Consumer<string, string, any> = {
  initial: [],
  update(s: string[], a: Chunk<string>) {

  },
  cont(s: any): boolean {
    return true
  },
  result(s: any): string {

  }
  remaining(s: any): Chunk<string> {

  }
}
