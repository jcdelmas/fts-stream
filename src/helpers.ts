
export type P<A> = A | Promise<A>

export class Either<L, R> {
    constructor(public fold: <T>(left: (l: L) => T, right: (r: R) => T) => T) {}
}

export namespace Either {
    export function left<L>(l: L): Either<L, never> {
        return new Either((left) => left(l))
    }

    export function right<R>(r: R): Either<never, R> {
        return new Either((left, right) => right(r))
    }
}

export class Maybe<A> {
    constructor(public fold: <T>(just: (a: A) => T, empty: () => T) => T) {}
}

export namespace Maybe {
    export function just<A>(a: A): Maybe<A> {
        return new Maybe((just) => just(a))
    }

    export function empty(): Maybe<never> {
        return new Maybe((just, empty) => empty())
    }
}
