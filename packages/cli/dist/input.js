/** "-s, --space-id <uuid>" → "space-id" */
export function extractLongFlag(flags) {
    const match = flags.match(/--([a-z][a-z0-9-]*)/);
    return match ? match[1] : '';
}
/** "space-id" → "spaceId"（Commander の opts キー） */
export function camelCase(str) {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
/**
 * manifest のオプション定義 → Commander が opts に格納するキー。
 * 否定形(--no-dry-run)は Commander が "no-" を外した正の名前(dryRun)に格納するので、
 * そのまま camelCase すると "noDryRun" になって値を拾えない（実際に踏んだバグ）。
 */
export function optionKey(def) {
    const longFlag = extractLongFlag(def.flags);
    const isNegatable = def.type === 'negatable' || longFlag.startsWith('no-');
    return camelCase(isNegatable ? longFlag.replace(/^no-/, '') : longFlag);
}
/** UTF-8 BOM を落とす（Excel/スプレッドシートの CSV 書き出しは BOM 付きが多い） */
export function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
/**
 * CLI オプションを params に足す（stdin 側に同じキーがあれば stdin を優先。spaceId だけは
 * CLI 側を優先＝呼び出し元で resolve 済みの値を渡す）。JSON/text 両モードで共通。
 */
export function mergeCliOptions(options, opts, params, resolvedSpaceId) {
    const out = { ...params };
    const spaceOpt = options.find((o) => o.resolve === 'spaceId');
    if (spaceOpt && out[spaceOpt.param] === undefined && resolvedSpaceId) {
        out[spaceOpt.param] = resolvedSpaceId;
    }
    for (const def of options) {
        if (def.param === 'stdin' || def.resolve === 'spaceId')
            continue;
        const key = optionKey(def);
        if (opts[key] !== undefined && out[def.param] === undefined) {
            out[def.param] = opts[key];
        }
    }
    return out;
}
/**
 * stdin（または --file）で受けた生テキストから params を作る。
 *  - stdinFormat='text': そのまま sub.stdinParam に入れる
 *  - それ以外(json): JSON.parse したオブジェクトを土台にする
 */
export function buildStdinParams(sub, rawText, opts, resolvedSpaceId) {
    const text = stripBom(rawText);
    let base;
    if (sub.stdinFormat === 'text') {
        if (!sub.stdinParam)
            throw new Error(`${sub.name}: manifest に stdinParam がありません`);
        if (text.trim() === '')
            throw new Error(`${sub.name}: 入力が空です（--file <path> か、stdin にファイルを流し込んでください）`);
        base = { [sub.stdinParam]: text };
    }
    else {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${sub.name}: stdin の JSON はオブジェクトにしてください`);
        }
        base = parsed;
    }
    return mergeCliOptions(sub.options, opts, base, resolvedSpaceId);
}
//# sourceMappingURL=input.js.map