import type { ManifestNotice } from './manifest-validator.js';
export interface NoticeStore {
    readSeen(): string[];
    writeSeen(ids: string[]): void;
}
export declare const fileNoticeStore: NoticeStore;
/** まだ見ていないお知らせを、日付順(古い→新しい)で返す */
export declare function pickUnseen(notices: ManifestNotice[] | undefined, seen: string[]): ManifestNotice[];
export declare function formatNotices(notices: ManifestNotice[]): string;
export interface ShowDeps {
    store: NoticeStore;
    print: (text: string) => void;
}
/** 未読のお知らせを表示して既読にする。表示した件数を返す。記録の失敗では落ちない */
export declare function showNewNotices(manifest: {
    notices?: ManifestNotice[];
}, deps?: ShowDeps): number;
