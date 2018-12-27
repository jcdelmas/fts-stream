import { Stream } from '../stream'
import { lines } from '../text'

describe('lines', () => {
  test('simple LF', async () => {
    const result = await Stream.single('foo\nbar\nbaz').pipe(lines).toArray()
    expect(result).toEqual(['foo', 'bar', 'baz'])
  })
  test('simple CR', async () => {
    const result = await Stream.single('foo\rbar\rbaz').pipe(lines).toArray()
    expect(result).toEqual(['foo', 'bar', 'baz'])
  })
  test('simple CRLF', async () => {
    const result = await Stream.single('foo\r\nbar\r\nbaz').pipe(lines).toArray()
    expect(result).toEqual(['foo', 'bar', 'baz'])
  })
  test('terminate by empty line LF', async () => {
    const result = await Stream.single('foo\nbar\nbaz\n').pipe(lines).toArray()
    expect(result).toEqual(['foo', 'bar', 'baz', ''])
  })
  test('terminate by empty line  CRLF', async () => {
    const result = await Stream.single('foo\r\nbar\r\nbaz\r\n').pipe(lines).toArray()
    expect(result).toEqual(['foo', 'bar', 'baz', ''])
  })
  test('empty line LF', async () => {
    const result = await Stream.single('foo\n\nbaz').pipe(lines).toArray()
    expect(result).toEqual(['foo', '', 'baz'])
  })
  test('empty line CRLF', async () => {
    const result = await Stream.single('foo\r\n\r\nbaz').pipe(lines).toArray()
    expect(result).toEqual(['foo', '', 'baz'])
  })
  test('with multiple strings LF', async () => {
    const result = await Stream.from(['abc\n', 'def\ngh', 'i', '\njk', 'l'])
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple strings CR', async () => {
    const result = await Stream.from(['abc\r', 'def\rgh', 'i', '\rjk', 'l'])
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple strings CRLF', async () => {
    const result = await Stream.from(['abc\r\n', 'def\r\ngh', 'i', '\r\njk', 'l'])
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple strings CRLF and a split separator', async () => {
    const result = await Stream.from(['abc\r', '\ndef'])
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def'])
  })
  test('with multiple chunks LF', async () => {
    const result = await Stream.single('abc\n')
      .concat(Stream.single('def\ngh'))
      .concat(Stream.single('i'))
      .concat(Stream.single('\njk'))
      .concat(Stream.single('l'))
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple chunks CR', async () => {
    const result = await Stream.single('abc\r')
      .concat(Stream.single('def\rgh'))
      .concat(Stream.single('i'))
      .concat(Stream.single('\rjk'))
      .concat(Stream.single('l'))
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple chunks CRLF', async () => {
    const result = await Stream.single('abc\r\n')
      .concat(Stream.single('def\r\ngh'))
      .concat(Stream.single('i'))
      .concat(Stream.single('\r\njk'))
      .concat(Stream.single('l'))
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def', 'ghi', 'jkl'])
  })
  test('with multiple chunks CRLF and a split separator', async () => {
    const result = await Stream.single('abc\r')
      .concat(Stream.single('\ndef'))
      .pipe(lines)
      .toArray()
    expect(result).toEqual(['abc', 'def'])
  })
  test('early stop', async () => {
    const result = await Stream.single('foo\nbar\nbaz').pipe(lines).take(2).toArray()
    expect(result).toEqual(['foo', 'bar'])
  })
})
