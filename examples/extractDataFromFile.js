const _ = require('lodash')
const file = require('../dist/node/file')
const path = require('path')
const { lines } = require('../dist/text')

// Extract all dependencies from yarn.lock
file.readTextFile(path.join(__dirname, '../yarn.lock'))
    .pipe(lines)
    .filter(l => /^\S.*/.test(l) && !l.startsWith('#'))
    .foreach(console.log)
    .catch(err => console.error(err))
