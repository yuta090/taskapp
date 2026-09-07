/**
 * Wiki 本文の取り込み変換。
 *
 * アプリの Wiki 画面（src/components/wiki/WikiEditor.tsx）は BlockNote のブロック配列を JSON 文字列で
 * 保存・表示する。JSON でない本文は表示時に捨てられ**空のページに見える**ため、CLI/MCP から受け取った
 * Markdown / HTML は保存前に必ず同じブロック形式へ変換する（以前は Markdown をそのまま保存していて
 * 画面では空に見えていた）。
 *
 * 変換は BlockNote 公式のサーバー用エディタ（@blocknote/server-util）に任せる。jsdom を含む重い依存
 * なので、必要になった時に初めて読み込み、以後は使い回す。
 */
const HTML_HINT = /^\s*<(!doctype|html|body|div|p|h[1-6]|ul|ol|table|section|article|span|br|pre)\b/i;
/** 本文の形式を推定する。JSON のブロック配列 → blocks / HTML らしければ html / それ以外 markdown */
export function detectWikiBodyFormat(body) {
    const trimmed = body.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.every((b) => b && typeof b === 'object' && 'type' in b)) {
                return 'blocks';
            }
        }
        catch {
            // JSON ではない → 下の判定へ
        }
    }
    if (HTML_HINT.test(trimmed) && /<\/[a-z][a-z0-9]*>/i.test(trimmed))
        return 'html';
    return 'markdown';
}
let editorPromise = null;
async function getServerEditor() {
    if (!editorPromise) {
        editorPromise = import('@blocknote/server-util').then((m) => m.ServerBlockNoteEditor.create());
    }
    return editorPromise;
}
/**
 * 本文を Wiki 画面が読めるブロック JSON 文字列にする。
 * - 空文字はそのまま空（画面では「クリックして本文を追加」相当）
 * - format 未指定なら detectWikiBodyFormat で推定
 */
export async function toWikiBlocksJson(body, format) {
    if (body.trim() === '')
        return '';
    const fmt = format ?? detectWikiBodyFormat(body);
    if (fmt === 'blocks')
        return body.trim();
    const editor = await getServerEditor();
    const blocks = fmt === 'html' ? await editor.tryParseHTMLToBlocks(body) : await editor.tryParseMarkdownToBlocks(body);
    return JSON.stringify(blocks);
}
//# sourceMappingURL=wikiBody.js.map