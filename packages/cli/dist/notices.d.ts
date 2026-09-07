import type { ManifestNotice } from './manifest-validator.js';
/** 一度に表示する上限 */
export declare const MAX_SHOWN = 5;
export interface NoticeStore {
    readSeen(): string[];
    writeSeen(ids: string[]): void;
}
/** 既読 id をファイルに残す store。path を差し替えてテストできる */
export declare function createFileNoticeStore(path: string): NoticeStore;
export declare const fileNoticeStore: NoticeStore;
/** 通常実行でお知らせを出してよいか: 端末につながっていて、--json でないとき */
export declare function shouldShowNotices(argv: string[], stderrIsTty: boolean): boolean;
/** まだ見ていないお知らせを、日付順(古い→新しい)で返す。同じ id が重複していれば最初の1件だけ */
export declare function pickUnseen(notices: ManifestNotice[] | undefined, seen: string[]): ManifestNotice[];
export declare function formatNotices(notices: ManifestNotice[], hiddenCount?: number): string;
export interface ShowDeps {
    store: NoticeStore;
    print: (text: string) => void;
}
/** 未読のお知らせを表示して既読にする。表示した件数を返す。記録の失敗では落ちない */
export declare function showNewNotices(manifest: {
    notices?: ManifestNotice[];
}, deps?: ShowDeps): number;
