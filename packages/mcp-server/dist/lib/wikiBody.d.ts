/**
 * Wiki 本文の取り込み変換（Markdown / HTML → BlockNote ブロック JSON）。
 *
 * アプリの Wiki 画面（src/components/wiki/WikiEditor.tsx）は BlockNote のブロック配列を JSON 文字列で
 * 保存・表示する。JSON でない本文は表示時に捨てられ**空のページに見える**ため、CLI/MCP から受け取った
 * Markdown / HTML は保存前に必ず同じブロック形式へ変換する。
 *
 * ⚠ BlockNote 公式のサーバー変換（@blocknote/server-util）は使わない。@blocknote/react 経由で React を
 *   読み込むため、Next.js のサーバー（Vercel）では RSC 用の React に差し替えられて
 *   `createContext is not a function` で落ちる（本番で踏んだ）。ここでは DOM も React も要らない
 *   marked（Markdown 解析）と turndown（HTML → Markdown）だけで、ブロック JSON を組み立てる。
 *   出力は WikiEditor / プリセット(src/lib/presets)が使っているブロック形（id なしの PartialBlock）に合わせる。
 */
export type WikiBodyFormat = 'markdown' | 'html' | 'blocks';
/** 本文の形式を推定する。JSON のブロック配列 → blocks / HTML らしければ html / それ以外 markdown */
export declare function detectWikiBodyFormat(body: string): WikiBodyFormat;
export interface InlineStyles {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strike?: boolean;
}
export type InlineContent = {
    type: 'text';
    text: string;
    styles: InlineStyles;
} | {
    type: 'link';
    href: string;
    content: {
        type: 'text';
        text: string;
        styles: InlineStyles;
    }[];
};
export interface Block {
    type: string;
    props?: Record<string, unknown>;
    content?: InlineContent[] | {
        type: 'tableContent';
        rows: {
            cells: InlineContent[][];
        }[];
    };
    children?: Block[];
}
export declare function markdownToBlocks(md: string): Block[];
export declare function htmlToMarkdown(html: string): string;
/**
 * 本文を Wiki 画面が読めるブロック JSON 文字列にする。
 * - 空文字はそのまま空
 * - format 未指定なら detectWikiBodyFormat で推定
 */
export declare function toWikiBlocksJson(body: string, format?: WikiBodyFormat): Promise<string>;
//# sourceMappingURL=wikiBody.d.ts.map