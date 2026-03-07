/**
 * Manifest schema validation + checksum verification
 */
import { createHash } from 'node:crypto'

export interface ManifestOption {
  flags: string
  description?: string
  param: string
  required?: boolean
  default?: string
  type?: 'int' | 'float' | 'bool' | 'json' | 'string[]' | 'negatable'
  choices?: string[]
  resolve?: 'spaceId'
  dependsOn?: string
  conflictsWith?: string
}

export interface ManifestSubcommand {
  name: string
  description: string
  aliases?: string[]
  tool: string
  examples?: string[]
  deprecated?: boolean
  hidden?: boolean
  stdinMode?: boolean
  options: ManifestOption[]
}

export interface ManifestCommand {
  name: string
  description: string
  aliases?: string[]
  tool?: string
  options?: ManifestOption[]
  subcommands?: ManifestSubcommand[]
}

export interface Manifest {
  version: string
  minCliVersion: string
  generatedAt: string
  checksum: string
  commands: ManifestCommand[]
}

// Validation regex patterns
const NAME_RE = /^[a-z][a-z0-9-]*$/
const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9]*$/
const TOOL_RE = /^[a-z][a-z_]*$/
const FLAGS_RE = /^(-[a-zA-Z],\s)?--[a-z][a-z0-9-]*(\s<[^>]+>)?$/

/** Strip ANSI escape sequences and control characters */
export function sanitize(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1f\x7f]|\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

function validateOption(opt: ManifestOption, path: string): void {
  if (!opt.flags || typeof opt.flags !== 'string') {
    throw new ManifestValidationError(`${path}: missing flags`)
  }
  // Allow --no-xxx negatable flags
  const flagsToCheck = opt.type === 'negatable' ? opt.flags.replace('--no-', '--') : opt.flags
  if (!FLAGS_RE.test(flagsToCheck)) {
    throw new ManifestValidationError(`${path}: invalid flags format: ${opt.flags}`)
  }
  if (!opt.param || !PARAM_RE.test(opt.param)) {
    throw new ManifestValidationError(`${path}: invalid param: ${opt.param}`)
  }
  if (opt.type && !['int', 'float', 'bool', 'json', 'string[]', 'negatable'].includes(opt.type)) {
    throw new ManifestValidationError(`${path}: invalid type: ${opt.type}`)
  }
}

function validateSubcommand(sub: ManifestSubcommand, path: string): void {
  if (!sub.name || !NAME_RE.test(sub.name)) {
    throw new ManifestValidationError(`${path}: invalid name: ${sub.name}`)
  }
  if (!sub.tool || !TOOL_RE.test(sub.tool)) {
    throw new ManifestValidationError(`${path}: invalid tool: ${sub.tool}`)
  }
  if (!sub.description || typeof sub.description !== 'string') {
    throw new ManifestValidationError(`${path}: missing description`)
  }
  if (!Array.isArray(sub.options)) {
    throw new ManifestValidationError(`${path}: options must be an array`)
  }
  for (let i = 0; i < sub.options.length; i++) {
    validateOption(sub.options[i], `${path}.options[${i}]`)
  }
}

function validateCommand(cmd: ManifestCommand, path: string): void {
  if (!cmd.name || !NAME_RE.test(cmd.name)) {
    throw new ManifestValidationError(`${path}: invalid name: ${cmd.name}`)
  }
  if (!cmd.description || typeof cmd.description !== 'string') {
    throw new ManifestValidationError(`${path}: missing description`)
  }

  // Top-level command with direct tool (e.g., dashboard)
  if (cmd.tool) {
    if (!TOOL_RE.test(cmd.tool)) {
      throw new ManifestValidationError(`${path}: invalid tool: ${cmd.tool}`)
    }
    if (cmd.options) {
      for (let i = 0; i < cmd.options.length; i++) {
        validateOption(cmd.options[i], `${path}.options[${i}]`)
      }
    }
  }

  // Command with subcommands
  if (cmd.subcommands) {
    if (!Array.isArray(cmd.subcommands)) {
      throw new ManifestValidationError(`${path}: subcommands must be an array`)
    }
    for (let i = 0; i < cmd.subcommands.length; i++) {
      validateSubcommand(cmd.subcommands[i], `${path}.subcommands[${i}]`)
    }
  }

  if (!cmd.tool && !cmd.subcommands) {
    throw new ManifestValidationError(`${path}: must have either tool or subcommands`)
  }
}

function verifyChecksum(manifest: Manifest): boolean {
  const expected = manifest.checksum
  if (!expected || !expected.startsWith('sha256:')) return false
  const computed = createHash('sha256').update(JSON.stringify(manifest.commands)).digest('hex')
  return expected === `sha256:${computed}`
}

/**
 * Validate a parsed manifest object.
 * Returns the typed manifest or throws ManifestValidationError.
 */
export function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestValidationError('Manifest must be a JSON object')
  }

  const m = raw as Record<string, unknown>

  if (typeof m.version !== 'string') {
    throw new ManifestValidationError('Missing version')
  }
  if (typeof m.minCliVersion !== 'string') {
    throw new ManifestValidationError('Missing minCliVersion')
  }
  if (!Array.isArray(m.commands)) {
    throw new ManifestValidationError('Missing commands array')
  }

  const manifest = raw as Manifest

  // Checksum verification (corruption detection)
  // Empty checksum is allowed for builtin manifest only (version '0.0.0-builtin')
  if (manifest.checksum) {
    if (!verifyChecksum(manifest)) {
      throw new ManifestValidationError('Checksum mismatch — manifest may be corrupted')
    }
  } else if (manifest.version !== '0.0.0-builtin') {
    throw new ManifestValidationError('Missing checksum — manifest integrity cannot be verified')
  }

  // Validate each command
  for (let i = 0; i < manifest.commands.length; i++) {
    validateCommand(manifest.commands[i], `commands[${i}]`)
  }

  // Sanitize display strings
  for (const cmd of manifest.commands) {
    cmd.description = sanitize(cmd.description)
    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        sub.description = sanitize(sub.description)
        if (sub.examples) {
          sub.examples = sub.examples.map(sanitize)
        }
        for (const opt of sub.options) {
          if (opt.description) opt.description = sanitize(opt.description)
        }
      }
    }
    if (cmd.options) {
      for (const opt of cmd.options) {
        if (opt.description) opt.description = sanitize(opt.description)
      }
    }
  }

  return manifest
}

/**
 * Compare semver strings: returns true if current >= required
 */
export function satisfiesVersion(current: string, required: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const [cMaj, cMin = 0, cPat = 0] = parse(current)
  const [rMaj, rMin = 0, rPat = 0] = parse(required)
  if (cMaj !== rMaj) return cMaj > rMaj
  if (cMin !== rMin) return cMin > rMin
  return cPat >= rPat
}
