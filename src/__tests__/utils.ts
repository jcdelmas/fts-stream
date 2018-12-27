import { delay } from '../promises'
import { Pipe, Stream } from '../stream'

interface TimeStep<A> {
  duration: number,
  value: A
}

export class TimedStream<A> {

  static of<A>(sequence: [number, A][]) {
    return new TimedStream<A>(sequence.map(([duration, value]) => ({ duration, value }))).toStream()
  }

  static then<A>(duration: number, value: A) {
    return new TimedStream<A>().then(duration, value)
  }

  constructor(private readonly sequence: TimeStep<A>[] = []) {
  }

  then(duration: number, value: A): this {
    this.sequence.push({ duration, value })
    return this
  }

  toStream() {
    const seq = this.sequence
    return Stream.fromAsyncIterator<A>(async function*() {
      for (const step of seq) {
        await delay(step.duration)
        yield step.value
      }
    }).buffer(256)
  }
}

export function withTime<A>(): Pipe<A, [A, number]> {
  return s => Stream.lazy(() => {
    const startTime = new Date().getTime()
    return s.map<[A, number]>(a => [a, new Date().getTime() - startTime])
  })
}

interface TimedEvent {
  duration: number,
  action: () => void
}

export function timeChecker<A>(results: [A, number][], expected: [A, number][]): void {
  const actual = results.map(([value, rawTime]) => [value, Math.floor((rawTime + 50) / 100) * 100])
  expect(actual).toEqual(expected)
}

export function delayed<A>(duration: number, result: A): Promise<A> {
  return delay(duration).then(() => result)
}

// export function delayedFlow<A>(duration: number): Flow<A, A> {
//   return delay(duration, 1, OverflowStrategy.BACK_PRESSURE)
// }

export function checkTime(time: number, expectedTime: number) {
  expect(time).toBeGreaterThan(expectedTime - 50)
  expect(time).toBeLessThan(expectedTime + 50)
}
