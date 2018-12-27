import _ from 'lodash'
import path from 'path'
import { delay } from '../../promises'
import { Stream } from '../../stream'
import { readBinaryFile, readTextFile, writeBinaryFile, writeTextFile } from '../file'

const tmpDir = process.env.TMPDIR || '/tmp'

describe('files', () => {
  test('write and read text file', async () => {
    const lines = 1100
    const fileName = `func-stream-${_.random(1000000000, 9999999999)}.txt`
    const filePath = path.join(tmpDir, fileName)

    await Stream.range(1, lines)
      .map(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_\n')
      .to(writeTextFile(filePath))
    await delay(500)
    const result = await readTextFile(filePath).fold(0, (sum, str) => sum + str.length)
    expect(result).toEqual(lines * 64)

  })

  test('write and read binary file', async () => {
    const lines = 1100
    const fileName = `func-stream-${_.random(1000000000, 9999999999)}.txt`
    const filePath = path.join(tmpDir, fileName)

    await Stream.range(1, lines)
      .map(() => Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_\n', 'UTF-8'))
      .to(writeBinaryFile(filePath))
    const result = await readBinaryFile(filePath).fold(0, (sum, str) => sum + str.length)
    expect(result).toEqual(lines * 64)
  })
})
