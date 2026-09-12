import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * PostgREST(Supabaseのデータ取得API)の埋め込み記法(`.select('a, b(...)')`)の歯止め。
 *
 * 1) `profiles` を埋め込むと必ず失敗する。本番には `profiles` を指す外部キーが
 *    1本も無い(profilesは auth.users を指すだけ)ため、`profiles(...)` 形の埋め込みは
 *    起点の表がどれであっても PGRST200(no matches were found)になる。
 * 2) 外部キーが2本以上ある表の組み合わせは、外部キー名を書かない埋め込みが
 *    PGRST201(more than one relationship was found)で失敗する。
 *
 * どちらも「別問い合わせにしてJS側で突き合わせる」か「`相手!<外部キー名>(...)`の
 * 形で外部キー名を書く」ことで直す。
 *
 * 検査は完全な構文解析ではない(入れ子の埋め込みは、内側の本当の起点でなく一番外の
 * `.from()`の表を起点として扱う簡易版)。見落としより誤検知のほうがましという方針
 * で、既存の正しいコードを壊さない範囲で広めに引っかける。
 */

// -----------------------------------------------------------------------
// 固定表: 外部キーが2本以上で繋がる表の組み合わせ(方向は問わない)。
// 本番の外部キー一覧(277本・2026-09-13時点で調査)から作成。
// 外部キーの増減でここがずれる。ずれた疑いがあるとき(このテストが変な組み合わせを
// 見逃した/誤検知したとき)は、本番のPostgRESTに `?select=<列>&limit=0` を当てて
// PGRST200/PGRST201が実際に起きるかを確かめ、この表を更新すること。
// -----------------------------------------------------------------------
const AMBIGUOUS_TABLE_PAIRS: Record<string, string[]> = {
  'api_keys<->users': ['api_keys_created_by_fkey', 'api_keys_user_id_fkey'],
  'billing_quotes<->users': ['billing_quotes_approved_by_fkey', 'billing_quotes_offered_by_fkey', 'billing_quotes_requested_by_fkey'],
  'channel_accounts<->channel_user_link_codes': ['channel_user_link_codes_account_org_fk', 'channel_user_link_codes_channel_account_id_fkey'],
  'channel_accounts<->channel_user_links': ['channel_user_links_account_org_fk', 'channel_user_links_channel_account_id_fkey'],
  'channel_digest_tasks<->users': ['channel_digest_tasks_confirmed_by_user_id_fkey', 'channel_digest_tasks_rejected_by_user_id_fkey', 'channel_digest_tasks_requested_to_user_id_fkey'],
  'channel_user_links<->users': ['channel_user_links_revoked_by_fkey', 'channel_user_links_user_id_fkey'],
  'blog_posts<->cta_blocks': ['blog_posts_footer_cta_id_fkey', 'blog_posts_inline_cta_id_fkey'],
  'discussion_items<->spaces': ['discussion_items_space_id_fkey', 'discussion_items_space_org_fkey'],
  'invites<->spaces': ['invites_space_id_fkey', 'invites_space_org_fkey'],
  'meeting_participants<->spaces': ['meeting_participants_space_id_fkey', 'meeting_participants_space_org_fkey'],
  'meeting_participants<->users': ['meeting_participants_created_by_fkey', 'meeting_participants_user_id_fkey'],
  'meetings<->spaces': ['meetings_space_id_fkey', 'meetings_space_org_fkey'],
  'milestones<->spaces': ['milestones_space_id_fkey', 'milestones_space_org_fkey'],
  'proposal_slots<->scheduling_proposals': ['proposal_slots_proposal_id_fkey', 'fk_confirmed_slot'],
  'reviews<->spaces': ['reviews_space_id_fkey', 'reviews_space_org_fkey'],
  'scheduling_proposals<->users': ['scheduling_proposals_confirmed_by_fkey', 'scheduling_proposals_created_by_fkey'],
  'slack_workspaces<->users': ['slack_workspaces_created_by_fkey', 'slack_workspaces_installed_by_fkey'],
  'spaces<->task_comments': ['task_comments_space_id_fkey', 'task_comments_space_org_fkey'],
  'spaces<->task_events': ['task_events_space_id_fkey', 'task_events_space_org_fkey'],
  'spaces<->task_owners': ['task_owners_space_id_fkey', 'task_owners_space_org_fkey'],
  'spaces<->task_pricing': ['task_pricing_space_id_fkey', 'task_pricing_space_org_fkey'],
  'spaces<->task_relations': ['task_relations_space_id_fkey', 'task_relations_space_org_fkey'],
  'spaces<->tasks': ['tasks_space_id_fkey', 'tasks_space_org_fkey'],
  'spaces<->users': ['spaces_archived_by_fkey', 'spaces_owner_user_id_fkey'],
  'spaces<->wiki_pages': ['wiki_pages_space_id_fkey', 'wiki_pages_space_org_fkey'],
  'task_relations<->tasks': ['task_relations_from_task_id_fkey', 'task_relations_to_task_id_fkey'],
  'tasks<->users': ['tasks_assignee_id_fkey', 'tasks_created_by_fkey'],
  'wiki_pages<->users': ['wiki_pages_created_by_fkey', 'wiki_pages_updated_by_fkey'],
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('<->')
}

interface Issue {
  message: string
}

// .select(...) 呼び出し本体を、開き括弧からの深さ数えで丸ごと抜き出す
// (中の文字列にある `(` `)` も同じ文字として一緒に数えれば十分・完全なJS構文解析はしない)
function extractCallArgs(code: string, openParenIndex: number): string {
  let depth = 1
  let i = openParenIndex + 1
  while (i < code.length && depth > 0) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') depth--
    i++
  }
  return code.slice(openParenIndex + 1, i - 1)
}

const FROM_RE = /\.from\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\)/g
const SELECT_RE = /\.select\(/g
// 埋め込み候補: (alias:)?table(!fk)*(  例: `spaces!inner(`, `actor:profiles!x_fkey(`, `wiki_pages(`
const EMBED_RE = /(?:^|[\s,`\n(])(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)((?:\s*!\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g

function findEmbedIssues(filePath: string, code: string): Issue[] {
  const issues: Issue[] = []

  const fromMatches: Array<{ index: number; table: string }> = []
  for (const m of code.matchAll(FROM_RE)) {
    fromMatches.push({ index: m.index! + m[0].length, table: m[1] })
  }
  if (fromMatches.length === 0) return issues

  for (const m of code.matchAll(SELECT_RE)) {
    const selectOpenParenIndex = m.index! + m[0].length - 1
    // 直前の .from() をこのselectの起点表とみなす(入れ子の埋め込みは一番外側の
    // 表を起点とみなす簡易版であることに注意)
    let sourceTable: string | null = null
    for (const f of fromMatches) {
      if (f.index <= m.index!) sourceTable = f.table
      else break
    }
    if (!sourceTable) continue

    const selectBody = extractCallArgs(code, selectOpenParenIndex)

    for (const em of selectBody.matchAll(EMBED_RE)) {
      const targetTable = em[1]
      const modifiers = em[2] || ''
      const fkNames = [...modifiers.matchAll(/!\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1])
      const hasExplicitFk = fkNames.some((n) => n !== 'inner')

      if (targetTable === 'profiles') {
        issues.push({
          message:
            `${filePath}: "profiles" を埋め込もうとしています。本番には profiles を指す外部キーが1本もありません` +
            `(profiles→auth.usersだけ)。profiles は別問い合わせ(.from('profiles').select(...).in('id', ids))で引き、` +
            `取得結果をJS側で突き合わせてください。`,
        })
        continue
      }

      if (hasExplicitFk) continue

      const key = pairKey(sourceTable, targetTable)
      const candidates = AMBIGUOUS_TABLE_PAIRS[key]
      if (candidates) {
        issues.push({
          message:
            `${filePath}: "${sourceTable}" から "${targetTable}" への埋め込みに外部キー名がありません。` +
            `この組み合わせは外部キーが${candidates.length}本あります(${candidates.join(', ')})。` +
            `"${targetTable}!<外部キー名>(...)" の形にしてください。` +
            `もしこの組み合わせに見覚えが無ければ、外部キーの一覧が変わっています。本番で ` +
            `'?select=...&limit=0' を当てて確かめ、この表(src/__tests__/lib/postgrestEmbedRegression.test.ts)を更新してください。`,
        })
      }
    }
  }

  return issues
}

function listSourceFiles(rootDir: string): string[] {
  const results: string[] = []
  function walk(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('._')) continue // exFATのAppleDoubleゴミ
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        results.push(full)
      }
    }
  }
  walk(rootDir)
  return results
}

const REPO_ROOT = process.cwd()
const SCAN_ROOTS = ['src/lib', 'src/app', 'packages/mcp-server/src']

describe('PostgREST埋め込みの歯止め', () => {
  it('src/lib・src/app・packages/mcp-server/src に、profilesの埋め込みや外部キー名の無い曖昧な埋め込みが無いこと', () => {
    const allIssues: Issue[] = []
    for (const root of SCAN_ROOTS) {
      const absoluteRoot = path.join(REPO_ROOT, root)
      for (const file of listSourceFiles(absoluteRoot)) {
        const code = fs.readFileSync(file, 'utf8')
        const relPath = path.relative(REPO_ROOT, file)
        allIssues.push(...findEmbedIssues(relPath, code))
      }
    }
    expect(allIssues.map((i) => i.message)).toEqual([])
  })

  // --- 検査ロジック自身の確認: わざと壊した断片に対して落ちること ---

  it('profilesの埋め込みを検知する', () => {
    const code = `
      const { data } = await admin
        .from('audit_logs')
        .select('id, actor_profile:profiles!audit_logs_actor_id_fkey(display_name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues.some((i) => i.message.includes('"profiles" を埋め込もうとしています'))).toBe(true)
  })

  it('profilesの埋め込みは、外部キー名を書いていても検知する(profilesを指す外部キーは無いため常に不可)', () => {
    const code = `
      .from('task_comments')
      .select('id, profiles!task_comments_actor_id_fkey(id, display_name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues.some((i) => i.message.includes('"profiles" を埋め込もうとしています'))).toBe(true)
  })

  it('外部キーが2本ある組み合わせ(tasks→spaces)を、外部キー名なしの埋め込みで検知する', () => {
    const code = `
      const { data } = await supabase
        .from('tasks')
        .select('id, spaces(name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues.some((i) => i.message.includes('外部キーが2本あります'))).toBe(true)
  })

  it('!inner だけでは外部キー名を書いたことにならず、引き続き検知する', () => {
    const code = `
      .from('tasks')
      .select('id, spaces!inner(name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('外部キー名を明示していれば検知しない', () => {
    const code = `
      .from('tasks')
      .select('id, spaces!tasks_space_id_fkey!inner(name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues).toEqual([])
  })

  it('外部キーが1本しか無い組み合わせ(space_memberships→spaces)は検知しない', () => {
    const code = `
      .from('space_memberships')
      .select('space_id, spaces!inner(id, name)')
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues).toEqual([])
  })

  it('別問い合わせ(profilesを埋め込まない形)は検知しない', () => {
    const code = `
      const { data: comments } = await supabase
        .from('task_comments')
        .select('id, body, actor_id')

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', actorIds)
    `
    const issues = findEmbedIssues('fixture.ts', code)
    expect(issues).toEqual([])
  })
})
