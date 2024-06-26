import _ from 'lodash'
import path from 'path'
import { Stream } from '@fts-stream/core'
import { readFile, readTextFile, writeFile, writeTextFile } from '../file'

const tmpDir = process.env.TMPDIR || '/tmp'

describe('files', () => {
  test('write and read text file', async () => {
    const lines = 1100
    const fileName = `func-stream-${_.random(1000000000, 9999999999)}.txt`
    const filePath = path.join(tmpDir, fileName)

    await Stream.range(0, lines)
      .map(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_\n')
      .to(writeTextFile(filePath))
    await delay(500)
    const result = await readTextFile(filePath).reduce(0, (sum, str) => sum + str.length)
    expect(result).toEqual(lines * 64)
  })

  test('write and read binary file', async () => {
    const lines = 1100
    const fileName = `func-stream-${_.random(1000000000, 9999999999)}.txt`
    const filePath = path.join(tmpDir, fileName)

    await Stream.range(0, lines)
      .map(() =>
        Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_\n', 'utf8'),
      )
      .to(writeFile(filePath))
    const result = await readFile(filePath).reduce(0, (sum, str) => sum + str.length)
    expect(result).toEqual(lines * 64)
  })
})

export function delay(millis: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, millis)
  })
}
