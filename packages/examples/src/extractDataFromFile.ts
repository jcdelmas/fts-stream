import { lines } from '@fts-stream/core'
import { readTextFile } from '@fts-stream/node'
import path from 'path'

// Extract all dependencies from yarn.lock
readTextFile(path.join(__dirname, '../../../yarn.lock'))
  .pipe(lines)
  .filter(l => /^\S.*/.test(l) && !l.startsWith('#'))
  .foreach(console.log)
  .catch(console.error)
