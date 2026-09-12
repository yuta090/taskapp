/**
 * CLI・API が返す「その物を画面で開くリンク」。
 *
 * Wiki や議事録の本文に貼るときは、この文字列をそのまま Markdown のリンク先に使える。
 * 画面側で差し込むときは `src/lib/navigation/appLinks.ts` が同じ形を組み立てる。
 * **どちらかだけ変えるとリンクが開かなくなる**ので、変えるときは両方そろえること
 * （綴りが揃っているかは `src/__tests__/lib/navigation/appLinks.crossPackage.test.ts` が見る）。
 */
/** `/{orgId}/project/{spaceId}` */
export function buildProjectBasePath(orgId, spaceId) {
    return `/${orgId}/project/${spaceId}`;
}
/** タスク一覧でそのタスクを開く */
export function buildTaskLink(orgId, spaceId, taskId) {
    return `${buildProjectBasePath(orgId, spaceId)}?task=${taskId}`;
}
/** Wiki のそのページを開く */
export function buildWikiPageLink(orgId, spaceId, pageId) {
    return `${buildProjectBasePath(orgId, spaceId)}/wiki?page=${pageId}`;
}
/** 議事録のその会議を開く */
export function buildMinutesLink(orgId, spaceId, meetingId) {
    return `${buildProjectBasePath(orgId, spaceId)}/meetings?meeting=${meetingId}`;
}
/** ファイルのダウンロード（画面遷移ではない） */
export function buildFileDownloadLink(fileId) {
    return `/api/files/${fileId}/download`;
}
/**
 * 行に `link` を足す。
 * CLI の表は先頭8列しか出さないので、`withTaskNumber` と同じく**先頭**に置く。
 */
export function withLink(row, link) {
    return { link, ...row };
}
/**
 * 行の**末尾**に `link` を足す。タスクのように先頭8列の並びが決まっているものに使う
 * （先頭に足すと、表示から押し出される列が出る）。
 */
export function withTrailingLink(row, link) {
    return { ...row, link };
}
//# sourceMappingURL=appLinks.js.map