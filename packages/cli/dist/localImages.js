/**
 * Wiki 本文（Markdown / HTML）の中の「手元の画像」を探してアップロードし、URL を差し替える。
 * サーバー側は `![説明](/api/files/<id>/download)` だけの行や `<img src>` を Wiki の画像ブロックに変換する。
 *
 * アップロードと存在確認は引数で差し替えられるようにし、テストで固定する。
 */
import { statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/**
 * 上げるのは画像の拡張子のものだけ。本文は外から持ってきた Markdown のこともあり、
 * `![](~/.ssh/id_rsa)` のような書き方で手元の鍵などがプロジェクトへ上がるのを防ぐ
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
function defaultExists(absPath) {
    try {
        return statSync(absPath).isFile();
    }
    catch {
        return false;
    }
}
/** 同じ長さの空白に置き換える（位置をずらさずにコード部分だけ検索対象から外す） */
function blank(s) {
    return s.replace(/[^\n]/g, ' ');
}
/** コードブロック（``` / ~~~）とインラインコードを空白に置き換えた検索用の文字列 */
function maskCode(text) {
    const fenced = text.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm, (m) => blank(m));
    return fenced.replace(/(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, (m) => blank(m));
}
function findRefs(text) {
    const masked = maskCode(text);
    const refs = [];
    // ![alt](url) / ![alt](url "title") / ![alt](<url with spaces>)
    const md = /(!\[[^\]\n]*\]\(\s*)(<[^>\n]*>|[^\s)<][^\s)]*)(?=\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\))/g;
    for (const m of masked.matchAll(md)) {
        const angle = m[2].startsWith('<');
        const start = m.index + m[1].length + (angle ? 1 : 0);
        const raw = angle ? m[2].slice(1, -1) : m[2];
        refs.push({ start, end: start + raw.length, url: raw });
    }
    // <img ... src="url" ...>（' と " の両方）
    const html = /(<img\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
    for (const m of masked.matchAll(html)) {
        const raw = m[2] ?? m[3] ?? '';
        const start = m.index + m[1].length + 1;
        refs.push({ start, end: start + raw.length, url: raw });
    }
    return refs.sort((a, b) => a.start - b.start);
}
function toAbsPath(url, baseDir) {
    if (!url || SCHEME_RE.test(url) || url.startsWith('//') || url.startsWith('/api/'))
        return null;
    let decoded = url;
    try {
        decoded = decodeURIComponent(url);
    }
    catch {
        // デコードできないときはそのまま探す
    }
    return decoded.startsWith('/') ? decoded : resolve(baseDir, decoded);
}
export async function uploadLocalImages(text, baseDir, upload, exists = defaultExists) {
    const targets = [];
    for (const ref of findRefs(text)) {
        const abs = toAbsPath(ref.url, baseDir);
        if (abs && IMAGE_EXTS.has(extname(abs).toLowerCase()) && exists(abs))
            targets.push({ ref, abs });
    }
    // 同じパスは1回だけ、出てきた順に1枚ずつ上げる
    const urlByPath = new Map();
    const uploaded = [];
    for (const { abs } of targets) {
        if (urlByPath.has(abs))
            continue;
        try {
            const url = await upload(abs);
            urlByPath.set(abs, url);
            uploaded.push({ path: abs, url });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`画像のアップロードに失敗しました（${abs}）: ${msg}`);
        }
    }
    let out = '';
    let cursor = 0;
    for (const { ref, abs } of targets) {
        out += text.slice(cursor, ref.start) + urlByPath.get(abs);
        cursor = ref.end;
    }
    out += text.slice(cursor);
    return { text: out, uploaded };
}
//# sourceMappingURL=localImages.js.map