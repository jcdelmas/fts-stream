import { Sink, Stream } from '@fts-stream/core'
import ReadableStream = NodeJS.ReadableStream
import WritableStream = NodeJS.WritableStream

export function readableToStringStream(factory: () => ReadableStream): Stream<string> {
  return readableToStream(factory) as Stream<string>
}

export function readableToBinaryStream(factory: () => ReadableStream): Stream<Buffer> {
  return readableToStream(factory) as Stream<Buffer>
}

function readableToStream(streamFactory: () => ReadableStream): Stream<Buffer | string> {
  return Stream.lazy(() => Stream.fromAsyncIterable(streamFactory()))
}

export function writableToSink<I extends Buffer | string, W extends WritableStream>(
  streamFactory: () => W,
): Sink<I, void> {
  return async stream => {
    const writable = streamFactory()

    let currentReject: ((err: any) => void) | undefined

    try {
      writable.on('error', err => {
        if (currentReject) currentReject(err)
      })

      function waitReady(): Promise<void> {
        return new Promise((resolve, reject) => {
          currentReject = reject
          writable.once('open', resolve) // ready event is specific to file streams
        })
      }

      function write(data: I): Promise<void> {
        return new Promise((resolve, reject) => {
          currentReject = reject
          if (!writable.write(data)) {
            writable.once('drain', () => resolve())
          } else {
            resolve()
          }
        })
      }

      await waitReady()
      for await (const a of stream) {
        await write(a)
      }
    } finally {
      writable.end()
    }
  }
}
