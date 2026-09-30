import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）向けの
 * 歯止め。createAdminClient() を引数無しで呼ぶと、そのクライアントで行った
 * 書き込みは change_log に channel='unattributed' で記録される（誰が・どの経路で
 * 書いたか分からない）。
 *
 * このテストは「無引数の呼び出しを今より増やさない」ための歯止め。既にある分は
 * このPRの範囲外（portal/cron/webhook/connector/admin パネルの一部だけ attribution を
 * 追加した）。**この数を減らす方向にだけ動かしてよい**。増やす変更は、新しい
 * createAdminClient() の呼び出しに attribution（{ channel, actorUserId? }）を
 * 付けるまでマージしないこと。
 */

// 現状カウントに含めない: attribution 引数そのものの定義・テストコード
const EXCLUDE_DIR_SEGMENTS = ['__tests__']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (EXCLUDE_DIR_SEGMENTS.some(seg => p.includes(`/${seg}`))) continue
      walk(p, out)
    } else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx')) {
      out.push(p)
    }
  }
  return out
}

/** コメント行（JSDoc の `*` 続き・`//`）に書かれた言及は呼び出し/参照ではない */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('*') || trimmed.startsWith('//')
}

// このPRの時点での無引数呼び出しの数。減らすのは歓迎、増やすときは各所に attribution を付ける。
const MAX_UNATTRIBUTED_CALLS = 6

describe('createAdminClient — 無引数呼び出しの歯止め', () => {
  it(`無引数の createAdminClient() 呼び出しは ${MAX_UNATTRIBUTED_CALLS} 件を超えない（減らす方向にだけ動かす）`, () => {
    const root = join(process.cwd(), 'src')
    // admin.ts 自身の定義（createAdminClient(attribution?: ...)）は呼び出しではないので除外
    const definitionFile = join(root, 'lib/supabase/admin.ts')

    let count = 0
    const offenders: string[] = []

    for (const file of walk(root)) {
      if (file === definitionFile) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return
        // createAdminClient() の直後に閉じ括弧が来る＝引数無し呼び出し
        const matches = line.match(/createAdminClient\(\)/g)
        if (matches) {
          count += matches.length
          offenders.push(`${file.replace(root, 'src')}:${i + 1}`)
        }
      })
    }

    expect(
      count,
      count > MAX_UNATTRIBUTED_CALLS
        ? `無引数の createAdminClient() 呼び出しが増えている（${count} 件）。新しい呼び出しには\n` +
          `createAdminClient({ channel: '...', actorUserId? }) で送信元を付けること。検出箇所:\n` +
          offenders.join('\n')
        : undefined,
    ).toBeLessThanOrEqual(MAX_UNATTRIBUTED_CALLS)
  })
})

/**
 * change_log トリガーの送信元記録を素通りする「自前 service_role クライアント」の歯止め。
 *
 * SUPABASE_SERVICE_ROLE_KEY を直接読んで supabase-js の createClient(...) に渡すコードは、
 * createAdminClient() の attribution ヘッダーが一切付かない（DB 側で channel='unattributed' に
 * なる以前に、そもそも change_log トリガーが読む x-agentpm-* ヘッダーの仕組みを迂回する）。
 * 新しく増やさないための歯止め。**この数を減らす方向にだけ動かしてよい**。
 *
 * ALLOWLIST は「クライアントを作らない」「DBへの書き込みを伴わない」等の理由で対象外にする
 * ファイルだけを載せる。理由をコメントで明記すること。
 */
const SERVICE_ROLE_KEY_ALLOWLIST: Record<string, string> = {
  'lib/supabase/storageObject.ts':
    'Supabase Storage オブジェクトの GET のみ（生 fetch の Authorization ヘッダー用）。' +
    'supabase-js の createClient(...) は作らず、change_log トリガー対象の table 書き込みも行わない。',
}

// このPRの時点での直接参照の数。0 を維持する（増やす変更はマージしない）。
const MAX_DIRECT_SERVICE_ROLE_KEY_REFS = 0

describe('SUPABASE_SERVICE_ROLE_KEY — 直接参照の歯止め', () => {
  it(`admin.ts を経由しない直接参照は ${MAX_DIRECT_SERVICE_ROLE_KEY_REFS} 件を超えない（allowlist 以外は createAdminClient() を使う）`, () => {
    const root = join(process.cwd(), 'src')
    const definitionFile = join(root, 'lib/supabase/admin.ts')

    let count = 0
    const offenders: string[] = []

    for (const file of walk(root)) {
      if (file === definitionFile) continue
      const relPath = file.replace(`${root}/`, '')
      if (SERVICE_ROLE_KEY_ALLOWLIST[relPath]) continue

      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return
        if (line.includes('SUPABASE_SERVICE_ROLE_KEY')) {
          count += 1
          offenders.push(`src/${relPath}:${i + 1}`)
        }
      })
    }

    expect(
      count,
      count > MAX_DIRECT_SERVICE_ROLE_KEY_REFS
        ? `SUPABASE_SERVICE_ROLE_KEY への直接参照が増えている（${count} 件）。\n` +
          `'@/lib/supabase/admin' の createAdminClient({ channel, actorUserId? }) を使うこと。\n` +
          `クライアントを作らない用途（生 fetch 等）だけ ALLOWLIST に理由付きで追加してよい。検出箇所:\n` +
          offenders.join('\n')
        : undefined,
    ).toBeLessThanOrEqual(MAX_DIRECT_SERVICE_ROLE_KEY_REFS)
  })
})
