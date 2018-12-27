const { Stream } = require('../dist/stream');
const { Chunk } = require('../dist/chunk')
const lodash = require('lodash')
const highland = require('highland')

function makeBar(len) {
  if (len <= 0) {
    return '';
  }
  else {
    return '#' + makeBar(len - 1);
  }
}

function pad(str, len) {
  if (str.length < len) {
    return pad(str, len - 1) + ' ';
  }
  else {
    return str;
  }
}

async function benchmark(name, obj) {
  let max = 0
  const results = []
  for (const libName in obj) {
    const start = new Date().getTime()
    await obj[libName]()
    const end = new Date().getTime()
    const duration = end - start
    if (duration > max) {
      max = duration
    }
    results.push({
      name: libName,
      duration: duration
    })
  }
  console.log('\n' + name + '\n')
  for (const r of results) {
    console.log(
        pad(r.name, 12) +
        makeBar(r.duration / max * 60) + ' ' +
        r.duration + 'ms'
    )
  }
  console.log('')
  console.log(touch)
}

// example data / functions used in tests
let touch = 0;
function square(x) {
  touch += x;
  return x * x;
}

function isEven(x) {
  return x % 2 === 0;
}

const arr10k = [];
for (let i = 0; i < 10000; i++) {
  arr10k.push(i);
}

const arr1M = [];
for (let i = 0; i < 1000000; i++) {
  arr1M.push(i);
}

(async () => {
  await benchmark('.map(square) x 1,000,000', {
    'func-stream': () => Stream.from(arr1M).map(square).toArray(),
    // 'func-stream2': () => Stream.range(1, 100).mapConcat(() => arr10k).map(square).toArray(),
    'chunk': () => Promise.resolve(Chunk.seq(arr1M).map(square).toArray()),
    'raw': () => Promise.resolve(arr1M.map(square)),
    'lodash': () => Promise.resolve(lodash(arr1M).map(square).value()),
    'highland': () => new Promise(resolve => highland(arr1M).map(square).toArray(resolve)),
  })

  await benchmark('.filter(isEvent) x 1,000,000', {
    'func-stream': () => Stream.from(arr1M).filter(isEven).toArray(),
    // 'func-stream2': () => Stream.range(1, 100).mapConcat(() => arr10k).filter(isEven).toArray(),
    'chunk': () => Promise.resolve(Chunk.seq(arr1M).filter(isEven).toArray()),
    'raw': () => Promise.resolve(arr1M.filter(isEven)),
    'lodash': () => Promise.resolve(lodash(arr1M).filter(isEven).value()),
    'highland': () => new Promise(resolve => highland(arr1M).filter(isEven).toArray(resolve)),
  })

  await benchmark('.map(square).filter(isEven).take(100) x 1,000,000', {
    'func-stream': () => Stream.range(0, 1000000).map(square).filter(isEven).take(100).toArray(),
    'lodash': () => Promise.resolve(lodash(arr1M).map(square).filter(isEven).take(100).value()),
    'highland': () => new Promise(resolve => highland(arr1M).map(square).filter(isEven).take(100).toArray(resolve)),
    'raw': () => Promise.resolve(arr1M.map(square).filter(isEven).slice(0, 100)),
  })

  await benchmark('foreach', {
    unckunked: () => Stream.range(1, 1000000).foreach(a => {}),
    chunked: () => Stream.from(lodash.range(1, 1000001)).foreach(a => {})
  })
})()
