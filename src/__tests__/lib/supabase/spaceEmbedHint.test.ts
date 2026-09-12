import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * space 単位の表と spaces の埋め込みに「どの外部キーでたどるか」が書かれているかを見張る番人。
 *
 * **なぜ必要か**: `20260911155718_space_org_fk.sql` で、12表に
 * `(space_id, org_id) → spaces(id, org_id)` の外部キー（`<表>_space_org_fkey`）を足した。
 * 元からある `space_id → spaces(id)`（`<表>_space_id_fkey`）も意図して残したため、
 * PostgREST（Supabase の自動API）から見ると「その表と spaces をつなぐ道が2本」になった。
 * すると `spaces(...)` / `spaces!inner(...)` のように道を指定しない埋め込みは
 * `Could not embed because more than one relationship was found for 'tasks' and 'spaces'`
 * で**本番で失敗する**（2026-09-12: 期日リマインドの cron が停止していた）。
 * ユニットテストはDBをモックするので、この失敗はテストでは見えない。ソースを読んで先に止める。
 *
 * **規則**: 12表 ↔ spaces の埋め込みは外部キー名を必ず書く。
 *   例: `.from('tasks').select('id, spaces!tasks_space_id_fkey!inner(org_id)')`
 *   `space_id` 側（`<表>_space_id_fkey`）を使う。`space_org_fk` はロールバック節で外せる作りのため。
 *
 * **見る範囲**: `.from('<表>')` に続く最初の `.select(...)` の文字列リテラル。
 * 入れ子の埋め込み（例 `reviews` → `tasks(... spaces(...))`）と逆向き（spaces → 12表）も見る。
 * select を変数で渡している箇所は見られない（そこは人が気をつける）。
 */

/** space_org_fk で spaces への外部キーが2本になった表（マイグレーションの節 1 と同じ並び） */
const SPACE_SCOPED_TABLES = new Set([
  'tasks', 'milestones', 'meetings', 'reviews', 'task_owners', 'task_pricing', 'task_events',
  'task_relations', 'wiki_pages', 'discussion_items', 'meeting_participants', 'task_comments',
])

const ROOT = path.resolve(__dirname, '../../../..')
const SCAN_DIRS = ['src', 'packages/mcp-server/src', 'worker', 'supabase/functions']
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))

function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // exFAT 上で macOS が作る `._*`（リソースフォーク）や隠しファイルはソースではない
    if (entry.name.startsWith('.')) continue
    if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSources(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

type Relation = { name: string; hasFkHint: boolean }

/** `alias:name!hint!inner` → name と「外部キー名の指定があるか」（inner / left は結合の種類で、道の指定ではない） */
function parseRelation(token: string): Relation {
  const withoutAlias = token.trim().split(':').pop() ?? ''
  const [name, ...modifiers] = withoutAlias.split('!').map((s) => s.trim())
  return { name, hasFkHint: modifiers.some((m) => m !== '' && m !== 'inner' && m !== 'left') }
}

function isAmbiguousPair(parent: string, child: string): boolean {
  return (SPACE_SCOPED_TABLES.has(parent) && child === 'spaces')
    || (parent === 'spaces' && SPACE_SCOPED_TABLES.has(child))
}

/** select 文字列を括弧の深さでたどり、道の指定が無い 12表 ↔ spaces の埋め込みを返す */
export function findAmbiguousSpaceEmbeds(baseTable: string, select: string): { parent: string; child: string }[] {
  const found: { parent: string; child: string }[] = []
  const stack = [baseTable]
  let token = ''
  for (const ch of select) {
    if (ch === '(') {
      const rel = parseRelation(token)
      const parent = stack[stack.length - 1]
      if (isAmbiguousPair(parent, rel.name) && !rel.hasFkHint) found.push({ parent, child: rel.name })
      stack.push(rel.name)
      token = ''
    } else if (ch === ')') {
      stack.pop()
      token = ''
    } else if (ch === ',') {
      token = ''
    } else {
      token += ch
    }
  }
  return found
}

type Violation = { file: string; line: number; parent: string; child: string }

function scanFile(file: string): Violation[] {
  const source = fs.readFileSync(file, 'utf8')
  const violations: Violation[] = []
  for (const m of source.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g)) {
    const start = (m.index ?? 0) + m[0].length
    // 次の .from( までを1本のクエリとみなす（別クエリの select を拾わない）
    const rest = source.slice(start, start + 3000)
    const nextFrom = rest.search(/\.from\(/)
    const window = nextFrom === -1 ? rest : rest.slice(0, nextFrom)
    const sel = window.match(/\.select\(\s*(['"`])([\s\S]*?)\1/)
    if (!sel) continue
    const line = source.slice(0, m.index ?? 0).split('\n').length
    for (const v of findAmbiguousSpaceEmbeds(m[1], sel[2])) {
      violations.push({ file: path.relative(ROOT, file), line, ...v })
    }
  }
  return violations
}

describe('findAmbiguousSpaceEmbeds（番人の判定そのもの）', () => {
  it('tasks から道を指定しない spaces!inner は曖昧として拾う', () => {
    expect(findAmbiguousSpaceEmbeds('tasks', 'id, spaces!inner(org_id)')).toEqual([{ parent: 'tasks', child: 'spaces' }])
  })

  it('外部キー名つき（spaces!tasks_space_id_fkey!inner）は通す', () => {
    expect(findAmbiguousSpaceEmbeds('tasks', 'id, spaces!tasks_space_id_fkey!inner(org_id)')).toEqual([])
  })

  it('別名つき・入れ子（reviews → tasks → spaces）も拾う', () => {
    expect(findAmbiguousSpaceEmbeds('reviews', 'id, task:tasks!inner(id, space:spaces(name))'))
      .toEqual([{ parent: 'tasks', child: 'spaces' }])
  })

  it('逆向き（spaces → tasks）も拾う', () => {
    expect(findAmbiguousSpaceEmbeds('spaces', 'id, tasks(id)')).toEqual([{ parent: 'spaces', child: 'tasks' }])
  })

  it('道が1本の表（space_memberships など）からの spaces 埋め込みは対象外', () => {
    expect(findAmbiguousSpaceEmbeds('space_memberships', 'space_id, spaces!inner(id, organizations!inner(id))')).toEqual([])
  })
})

describe('12表 ↔ spaces の埋め込みは外部キー名を書く（space_org_fk 以降の本番失敗の再発防止）', () => {
  it('ソース全体に、道を指定しない埋め込みが無い', () => {
    const violations = SCAN_DIRS.flatMap((d) => listSources(d)).flatMap(scanFile)
    expect(violations).toEqual([])
  })
})
