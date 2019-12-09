# FTS-Stream

## Introduction

Stream processing library for NodeJS and the browser.

 * Typesafe
 * Asynchronous
 * Functional
 * Lazy
 * Back-pressure

```typescript
const fahrenheitToCelsius = (f: number): number => (f - 32.0) * (5.0/9.0);

await readTextFile('testdata/fahrenheit.txt', 'UTF-8')
    .pipe(text.lines)
    .filter(s => s.trim().length > 0 && !s.startsWith('//'))
    .map(line => fahrenheitToCelsius(Number(line)).toString())
    .intersperse('\n')
    .to(writeTextFile('testdata/celsius.txt'));
```

## Installation

    npm i fts-stream

    yarn add fts-stream

## Guide

### Main concepts

 * Stream
 * Pipe
 * Sink

### Back pressure

### Error handling


## API


