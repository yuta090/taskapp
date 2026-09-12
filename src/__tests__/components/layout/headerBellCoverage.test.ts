import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * お知らせベルの置き場所の抜け漏れ検査。
 *
 * AppShell はメイン領域の上に「ベルだけの行」を出す。これは縦を1行ぶん（約44px）食うので、
 * 各ページは自分のヘッダーの右端にベルを置き、その目印（data-header-bell）を付ける。
 * 目印が付いた画面では globals.css の :has() ルールでベル行が消える。
 *
 * 目印を付け忘れたページは「ベルだけの行」が残るだけで壊れはしないが、静かに元に戻る。
 * ここで一覧を固定して、抜けを機械的に見つける。
 */

const ROOT = join(__dirname, '../../../..')

/** ログイン後のアプリ画面（AppShell配下）で、自前のヘッダーを持つもの */
const PAGES_WITH_OWN_HEADER = [
  'src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/files/[fileId]/FileTablePageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient.tsx',
  'src/components/meeting/MinutesDocumentView.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/settings/SettingsHeader.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/views/gantt/GanttPageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/views/burndown/BurndownPageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/views/billing/BillingPageClient.tsx',
  'src/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient.tsx',
  'src/app/(internal)/inbox/InboxClient.tsx',
  'src/app/(internal)/my/MyTasksClient.tsx',
  // 秘書コンソールの7画面は自前ヘッダーを持たず、共通のタブバーが一番上に来る
  'src/components/secretary/SecretaryTabNav.tsx',
]

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('お知らせベルは各ページのヘッダー右上に置く', () => {
  it.each(PAGES_WITH_OWN_HEADER)('%s に目印(data-header-bell)がある', (rel) => {
    expect(read(rel)).toContain('data-header-bell')
  })

  it.each(PAGES_WITH_OWN_HEADER)('%s がベル本体を描画している', (rel) => {
    expect(read(rel)).toContain('AnnouncementBell')
  })

  // ベルを置き忘れたページのための逃げ道。ここを消すと、目印の無い画面から
  // お知らせに気づく手段が丸ごと無くなる
  it('AppShell 側のベル行は残す（目印の無いページの受け皿）', () => {
    const shell = read('src/components/layout/AppShell.tsx')
    expect(shell).toContain('data-appshell-bell-row')
    expect(shell).toContain('AnnouncementBell')
  })

  it('目印が付いたページではベル行を消すCSSがある', () => {
    const css = read('src/app/globals.css')
    expect(css).toMatch(/main:has\(\[data-header-bell\]\)\s*\[data-appshell-bell-row\]/)
  })
})
