import { describe, it, expect } from 'vitest'
import { resolveInAppLinkTarget } from '@/components/editor/inAppLinkNavigation'

/**
 * 本文中のリンクのうち「アプリの中の画面へ行くもの」だけを横取りして、
 * 同じタブで開き、ブラウザの「戻る」で書いていたページに戻れるようにする。
 * 横取りしてよいかの判定だけを、実際のクリックの形で確かめる。
 */

type ClickLike = Parameters<typeof resolveInAppLinkTarget>[0]

function clickOn(href: string | null, overrides: Partial<ClickLike> = {}): ClickLike {
  const anchor = document.createElement('a')
  if (href !== null) anchor.setAttribute('href', href)
  const target = document.createElement('span')
  anchor.appendChild(target)
  document.body.appendChild(anchor)
  return {
    target,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  } as ClickLike
}

describe('resolveInAppLinkTarget — どのリンクを同じタブで開くか', () => {
  it('プロジェクトの画面へのリンクは横取りする', () => {
    expect(resolveInAppLinkTarget(clickOn('/org-1/project/space-1?task=t1'))).toBe(
      '/org-1/project/space-1?task=t1'
    )
  })

  it('Wikiページ・議事録へのリンクも横取りする', () => {
    expect(resolveInAppLinkTarget(clickOn('/o/project/s/wiki?page=p1'))).toBe('/o/project/s/wiki?page=p1')
    expect(resolveInAppLinkTarget(clickOn('/o/project/s/meetings?meeting=m1'))).toBe(
      '/o/project/s/meetings?meeting=m1'
    )
  })

  it('ファイルのダウンロードは横取りしない（画面が変わらないので今までどおり）', () => {
    expect(resolveInAppLinkTarget(clickOn('/api/files/f1/download'))).toBeNull()
  })

  it('外部のサイトは横取りしない', () => {
    expect(resolveInAppLinkTarget(clickOn('https://example.com'))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn('//example.com'))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn('mailto:a@example.com'))).toBeNull()
  })

  it('リンクでない場所を押しても何もしない', () => {
    const target = document.createElement('span')
    document.body.appendChild(target)
    expect(resolveInAppLinkTarget({ target, button: 0 } as ClickLike)).toBeNull()
    expect(resolveInAppLinkTarget(clickOn(null))).toBeNull()
  })

  it('新しいタブで開きたい押し方は邪魔しない', () => {
    const href = '/org-1/project/space-1?task=t1'
    expect(resolveInAppLinkTarget(clickOn(href, { metaKey: true }))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn(href, { ctrlKey: true }))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn(href, { shiftKey: true }))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn(href, { altKey: true }))).toBeNull()
    expect(resolveInAppLinkTarget(clickOn(href, { button: 1 }))).toBeNull()
  })

  it('すでに他で処理されたクリックは横取りしない', () => {
    expect(
      resolveInAppLinkTarget(clickOn('/org-1/project/space-1?task=t1', { defaultPrevented: true }))
    ).toBeNull()
  })
})
