
## Missing functions

### Streams

 * From event
 * Tick

### Pipe

 * reduceAsync
 * scanAsync
 * distinctBy
 * groupAdjacentBy
 * groupWithin
 * Add inclusive parameter to `takeWhile`
 * Replaces `recoverWithRetries` by something like `attempts` in FS2.

### Fan-in

 * Interleave
 * Dynamic merge

### Fan-out

 * `alsoTo`
 * `observe`: Like `alsoTo` but without backpressure (drop elements)
 * Dynamic balance
 * Dynamic broadcast

### Sinks

 * reduce1 (no zero)
 * head
 * last
