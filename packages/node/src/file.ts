import fs, { PathLike, WriteStream } from 'fs'
import { Sink, Stream } from '@fts-stream/core'
import { readableToBinaryStream, readableToStringStream, writableToSink } from './stream'

interface ReadFileOptions {
  start?: number
  end?: number
}

export function readTextFile(
  path: PathLike,
  encoding: string = 'UTF-8',
  chunkSize: number = 16384,
  options?: ReadFileOptions,
): Stream<string> {
  return readableToStringStream(() =>
    fs.createReadStream(path, {
      ...options,
      encoding,
      autoClose: false,
      highWaterMark: chunkSize,
    }),
  )
}

export function readFile(
  path: PathLike,
  chunkSize: number = 16384,
  options?: ReadFileOptions,
): Stream<Buffer> {
  return readableToBinaryStream(() =>
    fs.createReadStream(path, {
      ...options,
      autoClose: false,
      highWaterMark: chunkSize,
    }),
  )
}

interface WriteFileOptions {
  start?: number
}

export function writeTextFile(
  path: PathLike,
  encoding: string = 'UTF-8',
  options?: WriteFileOptions,
): Sink<string, void> {
  return writableToSink<string, WriteStream>(() =>
    fs.createWriteStream(path, { ...options, encoding, autoClose: false }),
  )
}

export function writeFile(path: PathLike, options?: WriteFileOptions): Sink<Buffer, void> {
  return writableToSink<Buffer, WriteStream>(() =>
    fs.createWriteStream(path, { ...options, autoClose: false }),
  )
}
