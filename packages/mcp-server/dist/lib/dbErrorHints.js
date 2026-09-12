/**
 * DB のエラーコードから、次にできることが分かる短い日本語のヒントを返す。
 * 重複・必須項目の不足・つながりの不整合の3種類だけを扱い、それ以外
 * （見覚えのない理由）は中身を隠す（2026-07 のエラー詳細漏洩対策を崩さない）。
 */
const PG_ERROR_HINTS = {
    '23505': 'すでに登録されています（重複しています）',
    '23502': '必須の項目が指定されていません',
    '23503': '指定したIDが正しくないか、関連する行が見つかりません',
};
export function dbErrorHint(error) {
    return PG_ERROR_HINTS[error.code ?? ''] ?? null;
}
/**
 * DBが断った理由の中身をサーバーの記録にだけ残し、次にできることが分かる
 * ヒント（重複・必須項目の不足・つながりの不整合）があればそれを、無ければ
 * fallbackMessage を返す。
 */
export function hideDbErrorWithHint(error, context, fallbackMessage) {
    console.error(`${context} failed:`, error.code, error.message);
    return new Error(dbErrorHint(error) ?? fallbackMessage);
}
//# sourceMappingURL=dbErrorHints.js.map