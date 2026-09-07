/**
 * Manifest schema validation + checksum verification
 */
import { createHash } from 'node:crypto';
// Validation regex patterns
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const TOOL_RE = /^[a-z][a-z_]*$/;
const FLAGS_RE = /^(-[a-zA-Z],\s)?--[a-z][a-z0-9-]*(\s<[^>]+>)?$/;
/** Strip ANSI escape sequences and control characters */
export function sanitize(str) {
    // サーバーから来た文字列を端末に出すので、端末を操作・偽装できる文字を落とす:
    //  1) OSC(ESC ] … BEL: タイトル書き換え等)を丸ごと  2) CSI を含む ESC 系一般を丸ごと
    //  3) C0/C1 制御文字(U+009B の 8bit CSI 含む)と、表示方向を反転する文字(U+202E 等)
    // ESC 系を先に消すのが肝心(制御文字を先にすると ESC だけ消えて "[31m" が文字として残る)
    return (str
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
        .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]?/g, '')
        .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ''));
}
class ManifestValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ManifestValidationError';
    }
}
function validateOption(opt, path) {
    if (!opt.flags || typeof opt.flags !== 'string') {
        throw new ManifestValidationError(`${path}: missing flags`);
    }
    // Allow --no-xxx negatable flags
    const flagsToCheck = opt.type === 'negatable' ? opt.flags.replace('--no-', '--') : opt.flags;
    if (!FLAGS_RE.test(flagsToCheck)) {
        throw new ManifestValidationError(`${path}: invalid flags format: ${opt.flags}`);
    }
    if (!opt.param || !PARAM_RE.test(opt.param)) {
        throw new ManifestValidationError(`${path}: invalid param: ${opt.param}`);
    }
    if (opt.type && !['int', 'float', 'bool', 'json', 'string[]', 'negatable'].includes(opt.type)) {
        throw new ManifestValidationError(`${path}: invalid type: ${opt.type}`);
    }
}
function validateSubcommand(sub, path) {
    if (!sub.name || !NAME_RE.test(sub.name)) {
        throw new ManifestValidationError(`${path}: invalid name: ${sub.name}`);
    }
    if (!sub.tool || !TOOL_RE.test(sub.tool)) {
        throw new ManifestValidationError(`${path}: invalid tool: ${sub.tool}`);
    }
    if (!sub.description || typeof sub.description !== 'string') {
        throw new ManifestValidationError(`${path}: missing description`);
    }
    if (!Array.isArray(sub.options)) {
        throw new ManifestValidationError(`${path}: options must be an array`);
    }
    if (sub.stdinFormat !== undefined && !['json', 'text'].includes(sub.stdinFormat)) {
        throw new ManifestValidationError(`${path}: invalid stdinFormat: ${sub.stdinFormat}`);
    }
    if (sub.stdinFormat === 'text' && (!sub.stdinParam || !PARAM_RE.test(sub.stdinParam))) {
        throw new ManifestValidationError(`${path}: stdinFormat=text requires a valid stdinParam`);
    }
    if (sub.uploadMode !== undefined && typeof sub.uploadMode !== 'boolean') {
        throw new ManifestValidationError(`${path}: uploadMode must be a boolean`);
    }
    if (sub.uploadMode && (!sub.completeTool || !TOOL_RE.test(sub.completeTool))) {
        throw new ManifestValidationError(`${path}: uploadMode requires a valid completeTool`);
    }
    for (let i = 0; i < sub.options.length; i++) {
        validateOption(sub.options[i], `${path}.options[${i}]`);
    }
}
function validateCommand(cmd, path) {
    if (!cmd.name || !NAME_RE.test(cmd.name)) {
        throw new ManifestValidationError(`${path}: invalid name: ${cmd.name}`);
    }
    if (!cmd.description || typeof cmd.description !== 'string') {
        throw new ManifestValidationError(`${path}: missing description`);
    }
    // Top-level command with direct tool (e.g., dashboard)
    if (cmd.tool) {
        if (!TOOL_RE.test(cmd.tool)) {
            throw new ManifestValidationError(`${path}: invalid tool: ${cmd.tool}`);
        }
        if (cmd.options) {
            for (let i = 0; i < cmd.options.length; i++) {
                validateOption(cmd.options[i], `${path}.options[${i}]`);
            }
        }
    }
    // Command with subcommands
    if (cmd.subcommands) {
        if (!Array.isArray(cmd.subcommands)) {
            throw new ManifestValidationError(`${path}: subcommands must be an array`);
        }
        for (let i = 0; i < cmd.subcommands.length; i++) {
            validateSubcommand(cmd.subcommands[i], `${path}.subcommands[${i}]`);
        }
    }
    if (!cmd.tool && !cmd.subcommands) {
        throw new ManifestValidationError(`${path}: must have either tool or subcommands`);
    }
}
function verifyChecksum(manifest) {
    const expected = manifest.checksum;
    if (!expected || !expected.startsWith('sha256:'))
        return false;
    const computed = createHash('sha256').update(JSON.stringify(manifest.commands)).digest('hex');
    return expected === `sha256:${computed}`;
}
/**
 * Validate a parsed manifest object.
 * Returns the typed manifest or throws ManifestValidationError.
 */
export function validateManifest(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ManifestValidationError('Manifest must be a JSON object');
    }
    const m = raw;
    if (typeof m.version !== 'string') {
        throw new ManifestValidationError('Missing version');
    }
    if (typeof m.minCliVersion !== 'string') {
        throw new ManifestValidationError('Missing minCliVersion');
    }
    if (!Array.isArray(m.commands)) {
        throw new ManifestValidationError('Missing commands array');
    }
    const manifest = raw;
    // Checksum verification (corruption detection)
    // Empty checksum is allowed for builtin manifest only (version '0.0.0-builtin')
    if (manifest.checksum) {
        if (!verifyChecksum(manifest)) {
            throw new ManifestValidationError('Checksum mismatch — manifest may be corrupted');
        }
    }
    else if (manifest.version !== '0.0.0-builtin') {
        throw new ManifestValidationError('Missing checksum — manifest integrity cannot be verified');
    }
    // Validate each command
    for (let i = 0; i < manifest.commands.length; i++) {
        validateCommand(manifest.commands[i], `commands[${i}]`);
    }
    // Sanitize display strings
    for (const cmd of manifest.commands) {
        cmd.description = sanitize(cmd.description);
        if (cmd.subcommands) {
            for (const sub of cmd.subcommands) {
                sub.description = sanitize(sub.description);
                if (sub.examples) {
                    sub.examples = sub.examples.map(sanitize);
                }
                for (const opt of sub.options) {
                    if (opt.description)
                        opt.description = sanitize(opt.description);
                }
            }
        }
        if (cmd.options) {
            for (const opt of cmd.options) {
                if (opt.description)
                    opt.description = sanitize(opt.description);
            }
        }
    }
    // お知らせ: 形の正しいものだけ残す(壊れていても manifest 全体は弾かない。表示用の文字列なので制御文字は落とす)
    manifest.notices = sanitizeNotices(m.notices);
    return manifest;
}
const NOTICE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const NOTICE_MESSAGE_MAX = 500;
/** 受け取る上限。サーバーは直近 10 件しか残さない約束だが、別サーバーを向けた場合の最後の砦 */
export const NOTICES_MAX = 20;
/** 日付の無いお知らせは「最新」として並べる(古い扱いにすると上限で真っ先に落ちる) */
const NO_DATE = '9999-99-99';
function sanitizeNotices(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const n = item;
        if (typeof n.id !== 'string' || !NOTICE_ID_RE.test(n.id))
            continue;
        if (typeof n.message !== 'string')
            continue;
        const message = sanitize(n.message).trim();
        if (message.length === 0 || message.length > NOTICE_MESSAGE_MAX)
            continue;
        const notice = { id: n.id, message };
        if (typeof n.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.date))
            notice.date = n.date;
        out.push(notice);
    }
    // 多すぎる場合は新しい方を残す。サーバー側の並び順に頼らず、日付(無ければ末尾扱い)で並べてから切る
    return out
        .map((n, i) => ({ n, i }))
        .sort((a, b) => (a.n.date ?? NO_DATE).localeCompare(b.n.date ?? NO_DATE) || a.i - b.i)
        .map(({ n }) => n)
        .slice(-NOTICES_MAX);
}
/**
 * Compare semver strings: returns true if current >= required
 */
export function satisfiesVersion(current, required) {
    const parse = (v) => v.split('.').map(Number);
    const [cMaj, cMin = 0, cPat = 0] = parse(current);
    const [rMaj, rMin = 0, rPat = 0] = parse(required);
    if (cMaj !== rMaj)
        return cMaj > rMaj;
    if (cMin !== rMin)
        return cMin > rMin;
    return cPat >= rPat;
}
//# sourceMappingURL=manifest-validator.js.map