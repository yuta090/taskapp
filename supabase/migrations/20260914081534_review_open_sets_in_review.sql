-- 社内承認を依頼したら、タスクの状態も「社内承認中」にする
--
-- これまで依頼と状態は別々の操作だった。「社内承認を依頼」を押しても status は元のままで、
-- 逆に status を in_review にしても依頼は飛ばない。2回操作しないと揃わないので面倒になり、
-- せっかくの承認の仕組みが使われなくなっていた（ユーザー指摘）。
--
-- 直すのは**依頼したら状態が付いてくる**方向だけ。逆（状態を変えたら依頼が飛ぶ）はやらない。
-- 誰に頼むかが決まらないと依頼を作れないため。画面は status が in_review で依頼が無いとき、
-- 承認者を選ぶ欄を自動で開いて促す作りになっている（TaskReviewSection）。
--
-- 関数（_review_open_impl）を書き直すのではなく reviews にトリガーを置く。理由:
--   - 画面（rpc_review_open）・CLI（rpc_review_open_as / review_open）・今後増える経路の
--     すべてで同じ結果になる。呼び出し口ごとに書き足す必要がない。
--   - 170行の関数を丸ごと写し直さずに済む（写し間違いの危険を避ける）。

CREATE OR REPLACE FUNCTION public.sync_task_status_on_review_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 依頼が「返事待ち（open）」になったときだけ。approved / changes_requested /
  -- cancelled では状態を動かさない（承認できたら完了にするかは人が決める）。
  IF NEW.status = 'open' THEN
    UPDATE tasks
    SET status = 'in_review', updated_at = now()
    WHERE id = NEW.task_id
      -- 既に in_review なら触らない（updated_at をむだに進めない）。
      -- done のタスクは戻さない（完了後に依頼を作り直す場面で、完了を取り消してしまわない）。
      AND status NOT IN ('in_review', 'done');
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_task_status_on_review_open() IS
  '社内承認の依頼が open になったら、そのタスクの status を in_review にする（done は除く）';

DROP TRIGGER IF EXISTS trg_sync_task_status_on_review_open ON public.reviews;
CREATE TRIGGER trg_sync_task_status_on_review_open
  AFTER INSERT OR UPDATE OF status ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_status_on_review_open();

-- トリガー関数は呼び出し側に実行権を渡さない（Postgres がトリガーとして呼ぶ）。
REVOKE ALL ON FUNCTION public.sync_task_status_on_review_open() FROM public, anon, authenticated;

-- 適用後の確認:
--   1. backlog のタスクに「社内承認を依頼」→ 一覧の状態が「社内承認中」になる。
--   2. CLI の `agentpm review open` でも同じになる。
--   3. 既に in_review のタスクに再依頼しても updated_at が動かない。
--   4. done のタスクに依頼を作っても done のまま。
--   5. 承認しても完了にはならない（完了は人が押す）。
