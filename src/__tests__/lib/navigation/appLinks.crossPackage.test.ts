import { describe, it, expect } from 'vitest'
import {
  buildFileDownloadHref,
  buildMinutesHref,
  buildProjectBasePath,
  buildTaskHref,
  buildWikiPageHref,
  isInAppScreenHref,
} from '@/lib/navigation/appLinks'
import {
  buildFileDownloadLink,
  buildMinutesLink,
  buildProjectBasePath as buildProjectBasePathCore,
  buildTaskLink,
  buildWikiPageLink,
} from '../../../../packages/mcp-server/src/lib/appLinks'

/**
 * 画面（`src/lib/navigation/appLinks.ts`）と CLI/API（`packages/mcp-server`）は、
 * パッケージをまたぐので同じモジュールを共有できない。綴りがずれると、CLI が返した
 * リンクを本文に貼っても開かない・画面が貼ったリンクを CLI が読み違える、が起きる。
 * ここで両方の出す文字列を突き合わせる。
 */
const ORG = '11111111-1111-1111-1111-111111111111'
const SPACE = '22222222-2222-2222-2222-222222222222'
const ID = '33333333-3333-3333-3333-333333333333'

describe('画面と CLI/API のリンクは同じ形', () => {
  it.each([
    ['プロジェクトの土台', buildProjectBasePath(ORG, SPACE), buildProjectBasePathCore(ORG, SPACE)],
    ['タスク', buildTaskHref(ORG, SPACE, ID), buildTaskLink(ORG, SPACE, ID)],
    ['Wikiページ', buildWikiPageHref(ORG, SPACE, ID), buildWikiPageLink(ORG, SPACE, ID)],
    ['議事録', buildMinutesHref(ORG, SPACE, ID), buildMinutesLink(ORG, SPACE, ID)],
    ['ファイル', buildFileDownloadHref(ID), buildFileDownloadLink(ID)],
  ])('%s', (_name, fromApp, fromCli) => {
    expect(fromCli).toBe(fromApp)
  })

  it('CLI が返す画面のリンクは、画面側が「同じタブで開く対象」と判定する', () => {
    expect(isInAppScreenHref(buildTaskLink(ORG, SPACE, ID))).toBe(true)
    expect(isInAppScreenHref(buildWikiPageLink(ORG, SPACE, ID))).toBe(true)
    expect(isInAppScreenHref(buildMinutesLink(ORG, SPACE, ID))).toBe(true)
    // ファイルはダウンロードなので対象外
    expect(isInAppScreenHref(buildFileDownloadLink(ID))).toBe(false)
  })
})
