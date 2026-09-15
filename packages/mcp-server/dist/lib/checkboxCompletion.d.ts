/**
 * 議事録でチェックが付いている行から、タスクの目印（`<!--task:uuid-->`）を取り出す。
 *
 * 画面側は `src/lib/minutes/checkboxCompletion.ts` に同じものがある。パッケージをまたぐので
 * 実装は共有できない。**片方だけ直すと、同じ本文なのに画面と CLI で拾う行が変わる**ので、
 * `src/__tests__/lib/checkboxCompletionParity.test.ts` で振る舞いを突き合わせている
 * （specLinkParity.test.ts と同じ考え方）。
 */
/**
 * 本文1つを見て、「チェックが付いている」かつ「タスクがある」行の taskId を返す。
 *
 * 画面は「チェックが入った瞬間」を前後の本文の差分で拾うが、CLI には**前の本文が無い**。
 * そこで「いま付いているチェック」をまとめて拾う。呼び出し側がすでに完了のものを飛ばすので、
 * 何度実行しても結果は同じ。
 */
export declare function collectCheckedTaskIds(md: string): string[];
//# sourceMappingURL=checkboxCompletion.d.ts.map