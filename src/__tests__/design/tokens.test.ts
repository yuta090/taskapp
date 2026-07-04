import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CLIENT, WARNING, SAVING, APPROVE_BUTTON } from '@/lib/design/tokens'

// #88: amber は「クライアント可視」専用トークンに戻す。
// 警告/要対応/接続異常 = warning(orange)、保存中 = 中立(neutral)、承認 = green に統一する。

const SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

const values = (o: Record<string, string>) => Object.values(o)

describe('design tokens: 意味の分離 (#88)', () => {
  it('CLIENT は amber 専用（他の色相を混ぜない）', () => {
    for (const v of values(CLIENT)) {
      expect(v).toContain('amber')
      expect(v).not.toMatch(/orange|green|red|indigo|blue/)
    }
  })

  it('WARNING は orange（amber を使わない＝クライアント可視と衝突させない）', () => {
    for (const v of values(WARNING)) {
      expect(v).toContain('orange')
      expect(v).not.toContain('amber')
    }
  })

  it('SAVING は中立色（amber も orange も使わない＝一時的で低強調）', () => {
    for (const v of values(SAVING)) {
      expect(v).not.toMatch(/amber|orange/)
    }
  })

  it('APPROVE_BUTTON は green に統一（amber/emerald/indigo を承認に使わない）', () => {
    expect(APPROVE_BUTTON.solid).toContain('green-600')
    expect(APPROVE_BUTTON.soft).toContain('green')
    for (const v of values(APPROVE_BUTTON)) {
      expect(v).not.toMatch(/amber|emerald|indigo/)
    }
  })
})

describe('design tokens: テーマ拡張とドキュメント整合 (#88)', () => {
  it('globals.css に orange トークンが定義されている（warning 用）', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/--color-orange-500:/)
    expect(css).toMatch(/--color-orange-50:/)
  })
})

describe('design tokens: 誤用箇所の回帰ガード (#88)', () => {
  it('受信トレイの「要対応」バッジは amber を使わない（warning へ移行）', () => {
    const src = read('app/(internal)/inbox/InboxClient.tsx')
    // 要対応バッジは orange 系。amber の要対応バッジ表現が残っていないこと。
    expect(src).not.toContain('bg-amber-50 text-amber-700')
    expect(src).not.toContain('bg-amber-50/60 text-amber-600')
  })

  it('設定の接続警告ドットは amber を使わない（warning へ移行）', () => {
    const src = read('app/(internal)/[orgId]/project/[spaceId]/settings/SettingsLayout.tsx')
    expect(src).not.toContain('bg-amber-500 animate-pulse')
  })

  it('Wiki の保存中インジケータは amber を使わない（中立色へ移行）', () => {
    const src = read('app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient.tsx')
    expect(src).not.toContain('bg-amber-400')
  })

  it('ポータル承認ボタンは面ごとにバラバラでなく green に統一', () => {
    const detail = read('app/portal/task/[taskId]/PortalTaskDetailClient.tsx')
    expect(detail).not.toContain('bg-emerald-600')

    const email = read('app/portal/email-action/[token]/EmailActionClient.tsx')
    // 承認ボタン本体が amber-500 塗りでないこと
    expect(email).not.toContain('bg-amber-500 hover:bg-amber-600 text-white')

    const actionCard = read('components/portal/ui/ActionCard.tsx')
    // 承認アクションが indigo 塗りでないこと（green の soft スタイルへ）
    expect(actionCard).not.toContain('text-indigo-600 bg-indigo-50')
  })
})
