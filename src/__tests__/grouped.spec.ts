import { testStreamPurity, withFlowProp } from './helpers'
import { Stream } from '../stream'
import _ from 'lodash'

describe('grouped', () => {
  withFlowProp((n: number) => [(s: Stream<any>) => s.grouped(n), (a: any[]) => _.chunk(a, n)])
    .testStreamsWithName(s => `${s} - basic`, 2)
    .testStreamsWithName(s => `${s} - bigger`, 4)
    .testStreamsWithName(s => `${s} - one`, 1)

  testStreamPurity(Stream.range(1, 10).grouped(3))
})
