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
  /**
   * stdin の読み方。'json'(既定)はオブジェクトとして解釈し params にマージ、
   * 'text' は生テキストのまま stdinParam で指定した1パラメータに入れる（CSV取り込み等）。
   */
  stdinFormat?: 'json' | 'text'
  /** stdinFormat='text' のとき、テキストを入れるパラメータ名 */
  stdinParam?: string
  /**
   * ファイルアップロード（3段階）。true のとき CLI は `--file` のローカルファイルを読み、
   * tool（署名URL発行）→ 署名URLへ PUT → completeTool（完了確定）の順に処理する。
   * 旧 CLI(0.3.x 以前)はこのフィールドを知らず tool を直接呼ぶ（このコマンドだけ失敗する）。
   */
  uploadMode?: boolean
  /** uploadMode=true のとき、完了を確定するツール名 */
  completeTool?: string
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

/** サーバーが添える「お知らせ」。checksum の対象外で、旧 CLI は項目ごと無視する */
export interface ManifestNotice {
  id: string
  date?: string
  message: string
}

export interface Manifest {
  version: string
  minCliVersion: string
  generatedAt: string
  checksum: string
  commands: ManifestCommand[]
  /** validateManifest が必ず配列にする(サーバーが返さなければ []) */
  notices: ManifestNotice[]
}

// Validation regex patterns
const NAME_RE = /^[a-z][a-z0-9-]*$/
const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9]*$/
const TOOL_RE = /^[a-z][a-z_]*$/
const FLAGS_RE = /^(-[a-zA-Z],\s)?--[a-z][a-z0-9-]*(\s<[^>]+>)?$/

/** Strip ANSI escape sequences and control characters */
export function sanitize(str: string): string {
  // サーバーから来た文字列を端末に出すので、端末を操作・偽装できる文字を落とす:
  //  1) OSC(ESC ] … BEL: タイトル書き換え等)を丸ごと  2) CSI を含む ESC 系一般を丸ごと
  //  3) C0/C1 制御文字(U+009B の 8bit CSI 含む)と、表示方向を反転する文字(U+202E 等)
  // ESC 系を先に消すのが肝心(制御文字を先にすると ESC だけ消えて "[31m" が文字として残る)
  return (
    str
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
      .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]?/g, '')
      .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '')
  )
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
  if (sub.stdinFormat !== undefined && !['json', 'text'].includes(sub.stdinFormat)) {
    throw new ManifestValidationError(`${path}: invalid stdinFormat: ${sub.stdinFormat}`)
  }
  if (sub.stdinFormat === 'text' && (!sub.stdinParam || !PARAM_RE.test(sub.stdinParam))) {
    throw new ManifestValidationError(`${path}: stdinFormat=text requires a valid stdinParam`)
  }
  if (sub.uploadMode !== undefined && typeof sub.uploadMode !== 'boolean') {
    throw new ManifestValidationError(`${path}: uploadMode must be a boolean`)
  }
  if (sub.uploadMode && (!sub.completeTool || !TOOL_RE.test(sub.completeTool))) {
    throw new ManifestValidationError(`${path}: uploadMode requires a valid completeTool`)
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

  // お知らせ: 形の正しいものだけ残す(壊れていても manifest 全体は弾かない。表示用の文字列なので制御文字は落とす)
  manifest.notices = sanitizeNotices(m.notices)

  return manifest
}

const NOTICE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const NOTICE_MESSAGE_MAX = 500
/** 受け取る上限。サーバーは直近 10 件しか残さない約束だが、別サーバーを向けた場合の最後の砦 */
export const NOTICES_MAX = 20

function sanitizeNotices(raw: unknown): ManifestNotice[] {
  if (!Array.isArray(raw)) return []
  const out: ManifestNotice[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const n = item as Record<string, unknown>
    if (typeof n.id !== 'string' || !NOTICE_ID_RE.test(n.id)) continue
    if (typeof n.message !== 'string') continue
    const message = sanitize(n.message).trim()
    if (message.length === 0 || message.length > NOTICE_MESSAGE_MAX) continue
    const notice: ManifestNotice = { id: n.id, message }
    if (typeof n.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.date)) notice.date = n.date
    out.push(notice)
  }
  // 多すぎる場合は新しい方(末尾)を残す
  return out.slice(-NOTICES_MAX)
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
