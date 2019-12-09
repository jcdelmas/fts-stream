import _ from 'lodash'
import { Stream } from '../stream'
import { testStreamPurity, withFlowProp } from './helpers'

describe('grouped', () => {
  withFlowProp((n: number) => [(s: Stream<any>) => s.grouped(n), (a: any[]) => _.chunk(a, n)])
    .testStreamsWithName(s => `${s} - basic`, 2)
    .testStreamsWithName(s => `${s} - bigger`, 4)
    .testStreamsWithName(s => `${s} - one`, 1)

  testStreamPurity(Stream.range(1, 11).grouped(3))
})
