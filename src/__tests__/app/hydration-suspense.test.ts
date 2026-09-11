import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * React #418（サーバー描画とブラウザ最初の描画の食い違い）の回帰テスト。
 *
 * (internal) 配下は QueryProvider(PersistQueryClientProvider) が layout.tsx で1つだけ
 * マウントされ、IndexedDB からキャッシュを復元する。ページ単位で中身を
 * <Suspense fallback={...}>...</Suspense> で包むと、React 19.2 は Suspense の中身の
 * hydration をシェルの確定後に回すため、その間にシェルの effect（キャッシュ復元）が
 * 先に走ってしまい、サーバー描画(空キャッシュ)とブラウザ最初の描画(復元済みキャッシュ)
 * が食い違う。settings/page.tsx と同じ形（ページ単位の Suspense を持たない）にする。
 *
 * 部品内部の Suspense（遅延読み込みなど）は対象外。ここでは「ページの export default
 * 関数がトップレベルで Suspense を返していない」ことだけを見る。
 */
const ROOT = path.resolve(__dirname, '../../..')

const pages = [
  '(internal)/[orgId]/project/[spaceId]/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/views/gantt/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/views/burndown/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/meetings/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/wiki/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/dashboard/page.tsx',
  '(internal)/[orgId]/secretary/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/files/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/files/[fileId]/page.tsx',
  '(internal)/[orgId]/project/[spaceId]/views/billing/page.tsx',
  '(internal)/[orgId]/secretary/approvals/page.tsx',
  '(internal)/[orgId]/secretary/connect/line/groups/page.tsx',
  '(internal)/[orgId]/secretary/integrations/page.tsx',
]

describe('hydration #418: ページ単位の Suspense 包みを持たない', () => {
  it.each(pages)('%s', (rel) => {
    const src = readFileSync(path.join(ROOT, 'src/app', rel), 'utf8')
    expect(src).not.toMatch(/from ['"]react['"][\s\S]*?Suspense/)
    expect(src).not.toContain('<Suspense')
  })
})
