/**
 * 文書（Wiki・議事録）の本文に差し込む「アプリの中の物へのリンク」の単一情報源。
 *
 * 以前は行き先ごとに別々の場所で文字列を組み立てていて、`?task=` は3か所、`?meeting=` は
 * 2か所に散らばっていた。`meetingLinks.ts` の先頭が書き残しているとおり、この散らばりは
 * 過去に「押しても何も開かないリンク」を生んでいる。差し込む側はこのモジュールだけを見る。
 */
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { buildMeetingHref } from './meetingLinks'

/** 差し込めるリンクの種類 */
export type AppLinkKind = 'file' | 'wiki' | 'meeting' | 'task'

/** 差し込むリンク。href と、本文に表示する文字 */
export interface AppLink {
  href: string
  label: string
}

/** `/{orgId}/project/{spaceId}` */
export function buildProjectBasePath(orgId: string, spaceId: string): string {
  return `/${orgId}/project/${spaceId}`
}

/**
 * ファイルのダウンロード。署名付きURLへ転送する安定したリンクで、画面遷移ではない
 * （`src/app/api/files/[id]/download/route.ts`）
 */
export function buildFileDownloadHref(fileId: string): string {
  return `/api/files/${fileId}/download`
}

/** Wiki のそのページを開く */
export function buildWikiPageHref(orgId: string, spaceId: string, pageId: string): string {
  return `${buildProjectBasePath(orgId, spaceId)}/wiki?page=${pageId}`
}

/** 議事録のその会議を開く */
export function buildMinutesHref(orgId: string, spaceId: string, meetingId: string): string {
  return buildMeetingHref(buildProjectBasePath(orgId, spaceId), meetingId)
}

/** タスク一覧でそのタスクを開く */
export function buildTaskHref(orgId: string, spaceId: string, taskId: string): string {
  return buildTaskDeepLink(orgId, spaceId, taskId)
}

/**
 * アプリの中の「画面」へのリンクか。
 * ファイルのダウンロード（`/api/...`）はダウンロードが始まるだけで画面が変わらないので、
 * 同じタブで開いて履歴に積む対象からは外す。外部サイト（`http...`）も対象外。
 */
export function isInAppScreenHref(href: string | null | undefined): boolean {
  if (!href) return false
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/')
}

/** その場（右パネル・オーバーレイ）で開ける行き先 */
export interface InAppLinkTarget {
  kind: 'task' | 'wiki'
  id: string
}

/**
 * 本文のリンクが「このプロジェクトのタスク / Wiki」なら、その種類と ID を返す。
 * 上の buildTaskHref / buildWikiPageHref が作った形だけを読む。別のプロジェクト・別の組織は
 * その場で開けない（一覧を持っていない）ので null にして、これまでどおり画面を移らせる。
 */
export function parseInAppLinkTarget(
  href: string | null | undefined,
  orgId: string,
  spaceId: string
): InAppLinkTarget | null {
  if (!isInAppScreenHref(href)) return null
  const url = new URL(href!, 'http://local')
  const base = buildProjectBasePath(orgId, spaceId)
  if (url.pathname === base) {
    const taskId = url.searchParams.get('task')
    return taskId ? { kind: 'task', id: taskId } : null
  }
  if (url.pathname === `${base}/wiki`) {
    const pageId = url.searchParams.get('page')
    return pageId ? { kind: 'wiki', id: pageId } : null
  }
  return null
}
