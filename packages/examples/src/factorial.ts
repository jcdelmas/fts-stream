import { Stream } from '@fts-stream/core'

const factorials = Stream.range(1, 100).scan(1, (acc, next) => acc * next)

factorials
  .zipWith(Stream.range(1, 100), (num, idx) => `${idx}! = ${num}`)
  .throttle(1000)
  .foreach(console.log)
