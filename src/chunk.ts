
export abstract class Chunk<A> implements Iterable<A> {
  readonly abstract size: number
  readonly abstract isEmpty: boolean

  map<B>(f: (a: A) => B): Chunk<B> {
    const array = new Array(this.size)
    let i = 0
    for (const a of this) {
      array[i++] = f(a)
    }
    return Chunk.seq(array)
  }

  filter(f: (a: A) => boolean): Chunk<A> {
    const array = new Array(this.size)
    let i = 0
    for (const a of this) {
      if (f(a)) {
        array[i++] = a
      }
    }
    return Chunk.seq(array)
  }

  abstract head(): A | undefined

  drop(n: number): Chunk<A> {
    if (n === 0) return this
    if (n >= this.size) return Chunk.empty()
    return this._drop(n)
  }

  take(n: number): Chunk<A> {
    if (n === 0) return Chunk.empty()
    if (n >= this.size) return this
    return this._take(n)
  }

  takeWhile(f: (a: A) => boolean): Chunk<A> {
    let i = 0
    for (const a of this) {
      if (!f(a)) {
        return this.take(i)
      } else {
        i++
      }
    }
    return this
  }

  splitAt(n: number): [Chunk<A>, Chunk<A>] {
    if (n > this.size) throw new Error('Out of bounds')
    if (n === 0) return [Chunk.empty(), this]
    if (n === this.size) return [this, Chunk.empty()]
    return [this._take(n), this._drop(n)]
  }

  dropWhile(f: (a: A) => boolean): Chunk<A> {
    let i = 0
    for (const a of this) {
      if (!f(a)) {
        return this.drop(i)
      } else {
        i++
      }
    }
    return Chunk.empty()
  }

  mapAccum<S, B>(s: S, f: (s: S, a: A) => [S, B]): [Chunk<B>, S] {
    const seq = new Array(this.size)
    let i = 0
    for (const a of this) {
      const [s2, b] = f(s, a)
      seq[i++] = b
      s = s2
    }
    return [Chunk.seq(seq), s]
  }

  concat<B>(chunk: Chunk<B>): Chunk<A | B> {
    return chunk.isEmpty ? this : new Concat(this, chunk)
  }

  flatMap<B>(f: (a: A) => Chunk<B>): Chunk<B> {
    const bs: B[] = []
    for (const a of this) {
      for (const b of f(a)) {
        bs.push(b)
      }
    }
    return Chunk.seq(bs)
  }

  toArray() {
    const xs = new Array(this.size)
    let i = 0
    for (const x of this) {
      xs[i++] = x
    }
    return xs
  }

  /**
   * Materializes a chunk into a chunk backed by an array. This method can
   * improve the performance of bulk operations.
   */
  materialize(): Chunk<A> {
    return Chunk.seq(this.toArray())
  }

  abstract [Symbol.iterator](): Iterator<A>

  protected abstract _drop(n: number): Chunk<A>

  protected abstract _take(n: number): Chunk<A>
}

class Empty extends Chunk<never> {
  readonly isEmpty: boolean = true
  readonly size: number = 0

  head(): undefined {
    return undefined
  }

  concat<B>(chunk: Chunk<B>): Chunk<B> {
    return chunk
  }

  filter(f: (a: never) => boolean): Chunk<never> {
    return this
  }

  flatMap<B>(f: (a: never) => Chunk<B>): Chunk<B> {
    return this
  }

  map<B>(f: (a: never) => B): Chunk<B> {
    return this
  }

  drop(n: number): Chunk<never> {
    return this
  }

  dropWhile(f: (a: never) => boolean): Chunk<never> {
    return this
  }

  take(n: number): Chunk<never> {
    return this
  }

  takeWhile(f: (a: never) => boolean): Chunk<never> {
    return this
  }

  mapAccum<S, B>(s: S, f: (s: S, a: never) => [S, B]): [Chunk<B>, S] {
    return [this, s]
  }

  toArray(): any[] {
    return []
  }

  materialize(): Chunk<never> {
    return this
  }

  *[Symbol.iterator](): Iterator<never> {}

  protected _drop(n: number): Chunk<never> {
    throw new Error('Unreachable')
  }

  protected _take(n: number): Chunk<never> {
    throw new Error('Unreachable')
  }
}

class Singleton<A> extends Chunk<A> {
  readonly isEmpty: boolean = false
  readonly size: number = 1

  constructor(private value: A) {
    super()
  }

  head(): A {
    return this.value
  }

  filter(f: (a: A) => boolean): Chunk<A> {
    return f(this.value) ? this : Chunk.empty()
  }

  flatMap<B>(f: (a: A) => Chunk<B>): Chunk<B> {
    return f(this.value)
  }

  map<B>(f: (a: A) => B): Chunk<B> {
    return new Singleton(f(this.value))
  }

  drop(n: number): Chunk<A> {
    return this.filter(() => n === 0)
  }

  dropWhile(f: (a: A) => boolean): Chunk<A> {
    return this.filter(a => !f(a))
  }

  takeWhile(f: (a: A) => boolean): Chunk<A> {
    return this.filter(f)
  }

  mapAccum<S, B>(s: S, f: (s: S, a: A) => [S, B]): [Chunk<B>, S] {
    const [s2, b] = f(s, this.value)
    return [Chunk.singleton(b), s2]
  }

  toArray(): any[] {
    return [this.value]
  }

  materialize(): Chunk<A> {
    return this
  }

  *[Symbol.iterator](): Iterator<A> {
    yield this.value
  }

  protected _drop(n: number): Chunk<A> {
    throw new Error('Unreachable')
  }

  protected _take(n: number): Chunk<A> {
    throw new Error('Unreachable')
  }
}

class Seq<A> extends Chunk<A> {

  readonly size: number
  readonly isEmpty: boolean = false

  constructor(private seq: A[]) {
    super()
    this.size = seq.length
  }

  head(): A {
    return this.seq[0]
  }

  filter(f: (a: A) => boolean): Chunk<A> {
    return Chunk.seq(this.seq.filter(f))
  }

  map<B>(f: (a: A) => B): Chunk<B> {
    // Faster implementation than Array.map (on V8)
    let index = -1
    const result = new Array(this.size)
    while (++index < this.size) {
      result[index] = f(this.seq[index])
    }
    return Chunk.seq(result)
  }

  _drop(n: number): Chunk<A> {
    return Chunk.seq(this.seq.slice(n))
  }

  _take(n: number): Chunk<A> {
    return Chunk.seq(this.seq.slice(0, n))
  }

  toArray(): any[] {
    return this.seq
  }

  materialize(): Chunk<A> {
    return this
  }

  [Symbol.iterator]() {
    return this.seq[Symbol.iterator]()
  }
}

class StringChunk extends Chunk<string> {

  readonly isEmpty: boolean = false
  readonly size: number = this.str.length

  constructor(private str: string) {
    super()
  }

  head(): string {
    return this.str.charAt(0)
  }

  materialize(): Chunk<string> {
    return this
  }

  [Symbol.iterator](): Iterator<string> {
    return this.str[Symbol.iterator]()
  }

  protected _drop(n: number): Chunk<string> {
    return new StringChunk(this.str.slice(n))
  }

  protected _take(n: number): Chunk<string> {
    return new StringChunk(this.str.slice(0, n))
  }
}

class Concat<A, B> extends Chunk<A | B> {
  isEmpty: boolean = false
  size: number
  constructor(private left: Chunk<A>, private right: Chunk<B>) {
    super()
    this.size = this.left.size + this.right.size
  }

  head(): A {
    return this.left.head() as A // left is never empty
  }

  filter(f: (a: (A | B)) => boolean): Chunk<A | B> {
    return this.left.filter(f).concat(this.right.filter(f))
  }

  map<C>(f: (a: (A | B)) => C): Chunk<C> {
    return this.left.map(f).concat(this.right.map(f))
  }

  *[Symbol.iterator](): Iterator<A | B> {
    for (const a of this.left) {
      yield a
    }
    for (const b of this.right) {
      yield b
    }
  }

  protected _drop(n: number): Chunk<A | B> {
    if (n === this.left.size) return this.right
    if (n < this.left.size) return this.left.drop(n).concat(this.right)
    return this.right.drop(n - this.left.size)
  }

  protected _take(n: number): Chunk<A | B> {
    if (n === this.left.size) return this.left
    if (n < this.left.size) return this.left.take(n)
    return this.left.concat(this.right.take(n - this.left.size))
  }
}

export namespace Chunk {
  export function empty<A>(): Chunk<A> {
    return new Empty()
  }

  export function singleton<A>(a: A) {
    return new Singleton(a)
  }

  export function seq<A>(as: A[]) {
    if (as.length === 0) {
      return new Empty()
    } else if (as.length === 1) {
      return new Singleton(as[0])
    } else {
      return new Seq(as)
    }
  }

  export function str(s: string) {
    if (s.length === 0) return new Empty()
    if (s.length === 1) return new Singleton(s)
    return new StringChunk(s)
  }
}
