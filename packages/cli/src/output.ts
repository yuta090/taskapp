import chalk from 'chalk'
import Table from 'cli-table3'

export function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    if (Array.isArray(data)) {
      printTable(data)
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      const entries = Object.entries(obj)

      // Display all array-of-objects properties as tables
      for (const [key, value] of entries) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
          console.log(chalk.bold(`${key}:`))
          printTable(value as Record<string, unknown>[])
          console.log()
        }
      }

      // Print remaining non-array-of-objects values
      for (const [key, value] of entries) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
          continue // already printed as table
        }
        if (value === null || value === undefined) continue
        if (Array.isArray(value)) {
          console.log(`${chalk.gray(key)}: ${value.map(v => String(v)).join(', ')}`)
        } else if (typeof value === 'object') {
          console.log(`${chalk.gray(key)}: ${JSON.stringify(value, null, 2)}`)
        } else {
          console.log(`${chalk.gray(key)}: ${formatValue(key, value)}`)
        }
      }
    } else {
      console.log(data)
    }
  }
}

function printTable(rows: unknown[]): void {
  if (rows.length === 0) {
    console.log(chalk.gray('(no results)'))
    return
  }

  // Collect scalar keys from ALL rows (preserving insertion order from first occurrence)
  const seen = new Set<string>()
  const keys: string[] = []
  for (const row of rows) {
    const r = row as Record<string, unknown>
    for (const k of Object.keys(r)) {
      if (seen.has(k)) continue
      seen.add(k)
      // Include only scalar-ish columns (skip nested objects/arrays)
      const v = r[k]
      if (v === null || v === undefined || typeof v !== 'object' || v instanceof Date) {
        keys.push(k)
      }
    }
  }

  // Limit columns for readability
  const displayKeys = keys.slice(0, 8)

  const table = new Table({
    head: displayKeys.map((k) => chalk.cyan(k)),
    style: { head: [], border: [] },
    wordWrap: true,
  })

  for (const row of rows) {
    const r = row as Record<string, unknown>
    table.push(displayKeys.map((k) => {
      const v = r[k]
      return formatValue(k, v)
    }))
  }

  console.log(table.toString())
  console.log(chalk.gray(`${rows.length} row(s)`))
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return chalk.gray('-')
  if (typeof value === 'string') {
    // Status coloring
    if (key === 'status' || key === 'ball') {
      return colorStatus(value)
    }
    // Truncate long strings
    if (value.length > 50) return value.slice(0, 47) + '...'
    return value
  }
  if (typeof value === 'number') return chalk.yellow(String(value))
  if (typeof value === 'boolean') return value ? chalk.green('true') : chalk.red('false')
  return String(value)
}

function colorStatus(status: string): string {
  switch (status) {
    case 'done':
    case 'approved':
    case 'confirmed':
    case 'accepted':
      return chalk.green(status)
    case 'in_progress':
    case 'in_review':
    case 'open':
    case 'internal':
      return chalk.blue(status)
    case 'backlog':
    case 'todo':
    case 'planned':
    case 'pending':
      return chalk.yellow(status)
    case 'considering':
      return chalk.magenta(status)
    case 'cancelled':
    case 'expired':
    case 'changes_requested':
    case 'client':
      return chalk.red(status)
    default:
      return status
  }
}

export function outputError(error: unknown, jsonMode: boolean): void {
  const message = error instanceof Error ? error.message : String(error)
  if (jsonMode) {
    console.error(JSON.stringify({ error: message }))
  } else {
    console.error(chalk.red(`Error: ${message}`))
  }
  process.exit(1)
}
