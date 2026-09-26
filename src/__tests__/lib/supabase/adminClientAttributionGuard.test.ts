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

/** コメント行（JSDoc の `*` 続き・`//`）に書かれた「createAdminClient()」への言及は呼び出しではない */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('*') || trimmed.startsWith('//')
}

// このPRの時点での無引数呼び出しの数。減らすのは歓迎、増やすときは各所に attribution を付ける。
const MAX_UNATTRIBUTED_CALLS = 111

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
