import _ from 'lodash'
import { Stream } from '../stream';
import { testStreamPurity } from './helpers';

describe('sliding', () => {
    test('chunked', async () => {
        const result = await Stream.range(1, 10, 5).mapConcat(a => _.range(a, a + 5)).sliding(4).toArray()
        expect(result).toEqual([
            [1, 2, 3, 4],
            [2, 3, 4, 5],
            [3, 4, 5, 6],
            [4, 5, 6, 7],
            [5, 6, 7, 8],
            [6, 7, 8, 9],
            [7, 8, 9, 10],
        ])
    })

    test('unchunked', async () => {
        const result = await Stream.range(1, 10).sliding(4).toArray()
        expect(result).toEqual([
            [1, 2, 3, 4],
            [2, 3, 4, 5],
            [3, 4, 5, 6],
            [4, 5, 6, 7],
            [5, 6, 7, 8],
            [6, 7, 8, 9],
            [7, 8, 9, 10],
        ])
    })

    test('with step > 1', async () => {
        const result = await Stream.range(1, 10).sliding(4, 2).toArray()
        expect(result).toEqual([
            [1, 2, 3, 4],
            [3, 4, 5, 6],
            [5, 6, 7, 8],
            [7, 8, 9, 10],
        ])
    })

    test('with small last window', async () => {
        const result = await Stream.range(1, 9).sliding(4, 3).toArray()
        expect(result).toEqual([
            [1, 2, 3, 4],
            [4, 5, 6, 7],
            [7, 8, 9],
        ])
    })

    test('with step > n', async () => {
        const result = await Stream.range(1, 10).sliding(2, 3).toArray()
        expect(result).toEqual([
            [1, 2],
            [4, 5],
            [7, 8],
            [10],
        ])
    })

    testStreamPurity(Stream.range(1, 10).sliding(3, 2))
})
