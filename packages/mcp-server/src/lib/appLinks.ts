/**
 * CLI・API が返す「その物を画面で開くリンク」。
 *
 * Wiki や議事録の本文に貼るときは、この文字列をそのまま Markdown のリンク先に使える。
 * 画面側で差し込むときは `src/lib/navigation/appLinks.ts` が同じ形を組み立てる。
 * **どちらかだけ変えるとリンクが開かなくなる**ので、変えるときは両方そろえること
 * （綴りが揃っているかは `src/__tests__/lib/navigation/appLinks.crossPackage.test.ts` が見る）。
 */

/** `/{orgId}/project/{spaceId}` */
export function buildProjectBasePath(orgId: string, spaceId: string): string {
  return `/${orgId}/project/${spaceId}`
}

/** タスク一覧でそのタスクを開く */
export function buildTaskLink(orgId: string, spaceId: string, taskId: string): string {
  return `${buildProjectBasePath(orgId, spaceId)}?task=${taskId}`
}

/** Wiki のそのページを開く */
export function buildWikiPageLink(orgId: string, spaceId: string, pageId: string): string {
  return `${buildProjectBasePath(orgId, spaceId)}/wiki?page=${pageId}`
}

/** 議事録のその会議を開く */
export function buildMinutesLink(orgId: string, spaceId: string, meetingId: string): string {
  return `${buildProjectBasePath(orgId, spaceId)}/meetings?meeting=${meetingId}`
}

/** ファイルのダウンロード（画面遷移ではない） */
export function buildFileDownloadLink(fileId: string): string {
  return `/api/files/${fileId}/download`
}

/**
 * 行に `link` を足す。
 * CLI の表は先頭8列しか出さないので、`withTaskNumber` と同じく**先頭**に置く。
 */
export function withLink<T extends object>(row: T, link: string): { link: string } & T {
  return { link, ...row }
}

/**
 * 行の**末尾**に `link` を足す。タスクのように先頭8列の並びが決まっているものに使う
 * （先頭に足すと、表示から押し出される列が出る）。
 */
export function withTrailingLink<T extends object>(row: T, link: string): T & { link: string } {
  return { ...row, link }
}
