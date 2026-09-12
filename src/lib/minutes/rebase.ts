/**
 * 議事録の自動保存が競合（409）になったとき、それが「AI秘書やチャットの
 * `minutes_append`（DB関数 `rpc_minutes_append`）による末尾への追記」だけが原因なら、
 * 足された分の Markdown だけを取り出して呼び出し側（MinutesDocumentView）に渡すための
 * 純関数。呼び出し側はその Markdown を**生きているエディタの末尾に挿し込む**
 * （BlockNote の本物のトランザクションを起こし、いつもの onChange→自動保存をそのまま
 * 使う。本体を作り直さない）。合流後の全文を組み立てる仕事はここでは持たない。
 *
 * `rpc_minutes_append`（`supabase/migrations/20260912112247_meeting_minutes_editing.sql`
 * 102〜104行）は必ず
 *   minutes_md = case when coalesce(minutes_md,'') = '' then p_content
 *                     else minutes_md || E'\n\n' || p_content end
 * の形で書く。つまり「本文が空でなければ、追記の直前に必ず `\n\n` が挟まる」。
 *
 * **この `\n\n` を判定の必須条件にする**のが今回いちばん大事な点。理由は
 * `rpc_parse_meeting_minutes`（`supabase/migrations/20260911143112_space_role_boundary.sql`
 * 2256〜2281行、議事録からのタスク化）が SPEC 行に ` <!--task:uuid-->` という目印を
 * 足して**全文を書き戻す**ことにある。議事録の最終行がまだ目印の付いていない
 * `- [ ] SPEC(...)` 行だと、書き戻し後の本文は元の本文の**単純な前方一致**
 * （`theirs.startsWith(base)`）になってしまう——ただし追記のように `\n\n` を挟まず、
 * 最終行の末尾にそのまま目印の文字列がくっつく形で。もし前方一致「だけ」を
 * 追記の判定に使うと、この「タスク化による目印の付与」まで「末尾への追記」と
 * 誤判定し、目印を（本来の行ではなく）自分が最後に書いている行の末尾に貼り付けて
 * しまう。その結果、元の SPEC 行は目印を失ったまま残り、次のタスク化で
 * **同じ行から重複してタスクが作られる**（二重作成防止が壊れる）。
 * `\n\n` の有無で区別すれば、この「行の途中に文字が継ぎ足された」パターンは
 * 前方一致であっても弾かれ、合流させず競合の帯に倒せる。
 *
 * `\r\n` は考えない（保存経路は `\n` に正規化済み）。
 *
 * @param base   自分が保存の基準にしている本文（開いたとき、または前回の合流・保存が
 *               確定したときに「サーバーにあると分かっていた」生の本文）
 * @param theirs DBの今の本文（保存が競合したときに読み直した最新の生の本文）
 * @returns 末尾に追記されたとみなせるときは、その**追記された分の Markdown だけ**
 *          （`base` を含まない）。そう判定できない・追記が空のときは null
 */
export function appendOnlyAddition(base: string, theirs: string): string | null {
  let addition: string
  if (base === '') {
    // rpc_minutes_append は base が空のときだけ \n\n を入れずに書く。theirs 自体が
    // 追記された内容そのものになる。
    if (theirs === '') return null
    addition = theirs
  } else {
    // 本文が空でない場合、rpc_minutes_append は必ず base の直後に "\n\n" を挟んでから
    // 追記する。この区切りが無い（＝base の直後に別の文字が続いている）ものは、
    // 末尾に何か足されたように見えても「末尾への追記」とは言い切れない
    // （上のコメント参照: タスク化による目印付与などで前方一致だけが偶然成立しうる）。
    const marker = `${base}\n\n`
    if (!theirs.startsWith(marker)) return null
    addition = theirs.slice(marker.length)
  }

  // 低3: 追記が空白・改行だけなら、エディタに何も見えるものを足さない意味の無い
  // 差し込みになる。挿し込み処理自体を起こす価値が無いので null にする。
  return addition.trim() === '' ? null : addition
}
