import { bracket } from './promises'

export interface Managed<A> {
  use<B>(f: (a: A) => Promise<B>): Promise<B>
}

export class ManagedImpl<A> {

  constructor(
    private acquire: () => Promise<A>,
    private release: (a: A) => void
  ) {}

  use<B>(f: (a: A) => Promise<B>): Promise<B> {
    return this.acquire().then(a => bracket(() => f(a), () => this.release(a)))
  }
}
