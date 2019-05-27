
## Missing functions

### Streams

 * From event
 * Tick

### Pipe

 * reduceAsync
 * scanAsync
 * distinctBy
 * Add inclusive parameter to `takeWhile`
 * Replaces `recoverWithRetries` by something like `attempts` in FS2.

### Fan-in

 * Interleave

### Fan-out

 * `alsoTo`
 * `observe`: Like `alsoTo` but without backpressure (drop elements)

### Sinks

 * reduce1 (no zero)
 * head
 * last
