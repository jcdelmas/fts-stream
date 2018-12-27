import fs, { PathLike, WriteStream } from 'fs'
import { Sink, Stream } from '../stream'
import { nodeBinaryReadableStreamToStream, nodeStringReadableStreamToStream, nodeWritableStreamToSink } from './stream'

type ReadFileOptions = {
  start?: number
  end?: number
}

export function readTextFile(
  path: PathLike,
  encoding: string = 'UTF-8',
  chunkSize: number = 16384,
  options?: ReadFileOptions
): Stream<string> {
  return nodeStringReadableStreamToStream(
    () => fs.createReadStream(path, {
      ...options,
      encoding,
      highWaterMark: chunkSize,
      autoClose: false
    }),
    chunkSize,
    stream => stream.close()
  )
}

export function readBinaryFile(
  path: PathLike,
  chunkSize: number = 16384,
  options?: ReadFileOptions
): Stream<Buffer> {
  return nodeBinaryReadableStreamToStream(
    () => fs.createReadStream(path, {
      ...options,
      highWaterMark: chunkSize,
      autoClose: false
    }),
    chunkSize,
    stream => stream.close()
  )
}

type WriteFileOptions = {
  start?: number
}

export function writeTextFile(
  path: PathLike,
  encoding: string = 'UTF-8',
  options?: WriteFileOptions
): Sink<string, void> {
  return nodeWritableStreamToSink<string, WriteStream>(
    () => fs.createWriteStream(path, { ...options, encoding, autoClose: false })
  )
}

export function writeBinaryFile(
  path: PathLike,
  options?: WriteFileOptions
): Sink<Buffer, void> {
  return nodeWritableStreamToSink<Buffer, WriteStream>(
    () => fs.createWriteStream(path, { ...options, autoClose: false })
  )
}
