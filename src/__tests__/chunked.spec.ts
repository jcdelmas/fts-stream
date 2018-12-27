import { Stream } from '../stream'
import { testStreamPurity, withFlowProp } from './helpers'

describe('chunked', () => {
  withFlowProp((n: number) => [(s: Stream<any>) => s.chunked(n), (as: any[]) => as])
    .testStreamsWithName(s => `${s} - basic`, 2)
    .testStreamsWithName(s => `${s} - bigger`, 4)
    .testStreamsWithName(s => `${s} - one`, 1)

  testStreamPurity(Stream.range(1, 10).chunked(3))
})
