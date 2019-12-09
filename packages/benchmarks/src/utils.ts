export function makeBar(len: number): string {
  if (len <= 0) {
    return ''
  } else {
    return '#' + makeBar(len - 1)
  }
}

export function pad(str: string, len: number): string {
  if (str.length < len) {
    return pad(str, len - 1) + ' '
  } else {
    return str
  }
}

export async function benchmark<A>(
  name: string,
  obj: Record<string, () => Promise<A>>,
): Promise<void> {
  let max = 0
  let nameMaxLength = 0
  const results = []
  for (const libName in obj) {
    const start = new Date().getTime()
    await obj[libName]()
    const end = new Date().getTime()
    const duration = end - start
    if (duration > max) {
      max = duration
    }
    if (libName.length > nameMaxLength) {
      nameMaxLength = libName.length
    }
    results.push({
      name: libName,
      duration: duration,
    })
  }
  console.log('\n' + name + '\n')
  for (const r of results) {
    console.log(
      pad(r.name, nameMaxLength + 2) + makeBar((r.duration / max) * 60) + ' ' + r.duration + 'ms',
    )
  }
  console.log('')
}
