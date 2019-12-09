import { Stream } from '@fts-stream/core'
import lodash from 'lodash'
import highland from 'highland'
import { benchmark } from './utils'

// example data / functions used in tests
function square(x: number): number {
  return x * x
}

function isEven(x: number): boolean {
  return x % 2 === 0
}

const arr10k: number[] = []
for (let i = 0; i < 10000; i++) {
  arr10k.push(i)
}

const arr1M: number[] = []
for (let i = 0; i < 1000000; i++) {
  arr1M.push(i)
}

;(async () => {
  await benchmark('.map(square) x 1,000,000', {
    'fts-stream': () =>
      Stream.from(arr1M)
        .map(square)
        .toArray(),
    raw: () => Promise.resolve(arr1M.map(square)),
    lodash: () =>
      Promise.resolve(
        lodash(arr1M)
          .map(square)
          .value(),
      ),
    highland: () =>
      new Promise(resolve =>
        highland(arr1M)
          .map(square)
          .toArray(resolve),
      ),
  })

  await benchmark('.filter(isEvent) x 1,000,000', {
    'fts-stream': () =>
      Stream.from(arr1M)
        .filter(isEven)
        .toArray(),
    raw: () => Promise.resolve(arr1M.filter(isEven)),
    lodash: () =>
      Promise.resolve(
        lodash(arr1M)
          .filter(isEven)
          .value(),
      ),
    highland: () =>
      new Promise(resolve =>
        highland(arr1M)
          .filter(isEven)
          .toArray(resolve),
      ),
  })

  await benchmark('.map(square).filter(isEven).take(100) x 1,000,000', {
    'fts-stream': () =>
      Stream.range(0, 1000000)
        .map(square)
        .filter(isEven)
        .take(100)
        .toArray(),
    lodash: () =>
      Promise.resolve(
        lodash(arr1M)
          .map(square)
          .filter(isEven)
          .take(100)
          .value(),
      ),
    highland: () =>
      new Promise(resolve =>
        highland(arr1M)
          .map(square)
          .filter(isEven)
          .take(100)
          .toArray(resolve),
      ),
    raw: () =>
      Promise.resolve(
        arr1M
          .map(square)
          .filter(isEven)
          .slice(0, 100),
      ),
  })
})()
