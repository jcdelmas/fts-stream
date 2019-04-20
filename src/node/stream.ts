import { bracket } from '../promises'
import { Sink, Stream } from '../stream'
import ReadableStream = NodeJS.ReadableStream
import WritableStream = NodeJS.WritableStream
import { P } from '../helpers';

export function nodeStringReadableStreamToStream<S extends ReadableStream = ReadableStream>(
  streamFactory: () => S,
  chunkSize: number = 4096,
  close: (stream: S) => void = () => {},
): Stream<string> {
  return nodeReadableStreamToStream<S, string>(
    str => typeof str === 'string',
    'Text readable stream expected',
    streamFactory,
    close,
  )
}

export function nodeBinaryReadableStreamToStream<S extends ReadableStream = ReadableStream>(
  streamFactory: () => S,
  chunkSize: number = 4096,
  close: (stream: S) => void = () => {},
): Stream<Buffer> {
  return nodeReadableStreamToStream<S, Buffer>(
    Buffer.isBuffer,
    'Binary readable stream expected',
    streamFactory,
    close,
  )
}

function nodeReadableStreamToStream<S extends ReadableStream, O extends Buffer | string>(
  checker: (buf: Buffer | string) => boolean,
  errorMsg: string,
  streamFactory: () => S,
  close: (stream: S) => void = () => {},
): Stream<O> {
  return Stream.createSimple(push => {
    async function waitAndRead(readable: S): Promise<boolean> {
      return new Promise<boolean>((resolve, reject) => {
        readable.on('error', reject)
        let lastPush: P<boolean> | undefined
        readable.on('readable', () => {
          const downstreamReady = lastPush !== undefined ? lastPush : true
          Promise.resolve(downstreamReady).then(
            cont => {
              if (cont) {
                const buf = readable.read()
                if (buf) {
                  if (checker(buf)) {
                    lastPush = push(buf as O)
                  } else {
                    throw new Error(errorMsg)
                  }
                }
              }
            },
            reject,
          )
        })
        readable.on('end', () => resolve(true))
      })
    }

    const resource = streamFactory()
    return bracket<boolean>(
      () => waitAndRead(resource),
      () => close(resource),
    )
  })
}

export function nodeWritableStreamToSink<I extends Buffer | string, W extends WritableStream>(
  streamFactory: () => W,
): Sink<I, void> {
  return stream => {
    const writable = streamFactory()

    let failed = false
    let currentReject: ((err: any) => void) | undefined

    writable.on('error', err => {
      failed = true
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

    return waitReady()
      .then(() => stream.foreach0(chunk => write(chunk).then(() => !failed)).then(() => {}))
      .finally(() => writable.end())
  }
}
