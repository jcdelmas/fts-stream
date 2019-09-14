import { Stream } from '../stream'
import { testStreamPurity, testCancellation } from './helpers'
import { timeChecker, TimedStream, withTime } from './utils'

describe('buffer', () => {
  it('simple', async () => {
    Stream.from([1, 2, 3])
      .buffer(2)
      .toArray()
  })

  testCancellation(s => s.buffer())
})
