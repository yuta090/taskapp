/**
 * CLI・API が返す「その物を画面で開くリンク」。
 *
 * Wiki や議事録の本文に貼るときは、この文字列をそのまま Markdown のリンク先に使える。
 * 画面側で差し込むときは `src/lib/navigation/appLinks.ts` が同じ形を組み立てる。
 * **どちらかだけ変えるとリンクが開かなくなる**ので、変えるときは両方そろえること
 * （綴りが揃っているかは `src/__tests__/lib/navigation/appLinks.crossPackage.test.ts` が見る）。
 */
/** `/{orgId}/project/{spaceId}` */
export declare function buildProjectBasePath(orgId: string, spaceId: string): string;
/** タスク一覧でそのタスクを開く */
export declare function buildTaskLink(orgId: string, spaceId: string, taskId: string): string;
/** Wiki のそのページを開く */
export declare function buildWikiPageLink(orgId: string, spaceId: string, pageId: string): string;
/** 議事録のその会議を開く */
export declare function buildMinutesLink(orgId: string, spaceId: string, meetingId: string): string;
/** ファイルのダウンロード（画面遷移ではない） */
export declare function buildFileDownloadLink(fileId: string): string;
/**
 * 行に `link` を足す。
 * CLI の表は先頭8列しか出さないので、`withTaskNumber` と同じく**先頭**に置く。
 */
export declare function withLink<T extends object>(row: T, link: string): {
    link: string;
} & T;
/**
 * 行の**末尾**に `link` を足す。タスクのように先頭8列の並びが決まっているものに使う
 * （先頭に足すと、表示から押し出される列が出る）。
 */
export declare function withTrailingLink<T extends object>(row: T, link: string): T & {
    link: string;
};
//# sourceMappingURL=appLinks.d.ts.map