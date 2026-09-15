-- =============================================================================
-- タスクごとのコメント数を1回でまとめて返す（タスク一覧のコメントアイコンに数を出すため）
--
-- 目的:
--   プロジェクトのタスク一覧（src/lib/supabase/queries.ts の fetchTasksQuery）とマイタスク
--   （src/app/(internal)/my/MyTasksClient.tsx）に、タスクごとのコメント数を出す。行ごとに数えに行くと一覧が遅くなり、
--   PostgREST の埋め込みの count は外部キーの名前が本番と食い違って落ちた前例があるため、一覧の取得と並べて1回呼ぶ RPC にする。
--
-- 対応:
--   public.rpc_task_comment_counts(p_space_id, p_assignee_id, p_org_id) → (task_id, comment_count) を足す。
--   - SECURITY INVOKER: 呼んだ人の権限で task_comments / tasks を読むので、RLS（20260911143112_space_role_boundary.sql 節 4 の
--     task_comments_select と、20260703_010_rls_vendor_task_scope.sql の tasks_select_member）がそのまま効く。
--     見える範囲の判定は関数の中に写さない。
--     社内は全部の visibility、相手先は 'client'・vendor は 'vendor' の、見えるタスクのコメントだけが数に入る。
--   - 消したコメント（deleted_at あり）は数えない。0件のタスクは返さない。
--   - 絞り込み: p_space_id があればその space（プロジェクトの一覧）。p_assignee_id があれば tasks.assignee_id が一致するタスク
--     （マイタスク）。p_org_id があればその組織。p_space_id と p_assignee_id が両方 null なら0行（全件を数えさせない）。
--   - 本文は「space で絞る」と「担当者だけで絞る」の2本に分けて union all にしている。
--     `p_space_id is null or c.space_id = p_space_id` の形だと、引数の値が分からないまま作った実行計画で
--     task_comments(space_id) の索引が使えず、表を全部読むため。2本は p_space_id の有無で必ずどちらか1本だけが動く。
--   - `set search_path` は付けない。付けると SQL 関数が呼び出し側の問い合わせに展開（インライン化）されなくなり、
--     上の2本に分けた形でも索引の選び方が変わるため。表名はすべて public. 付きで書いてあり、呼んだ人の権限で動く
--     （security invoker）ので、search_path を差し替えられても広がる権限は無い。
--   - 実行権: public / anon から外し、authenticated にだけ付ける（新しい関数は既定で誰にも付かない。
--     20260911200801_function_default_privileges.sql）。service_role はスキーマの既定で付く。
--   - 索引は足さない。数千件のシードで explain analyze を取り、task_comments(task_id) / (space_id) の既存の索引で足りた
--     （時間の大半は RLS のポリシーが行ごとに呼ぶ関数で、索引では減らない）。
--
-- 確認: supabase/tests/run_task_comment_counts.sh（RED=1 で、本 migration が無いと失敗することも確かめる）
-- 適用の順番: 画面の変更より先に当てる（先に画面が出ると、この RPC を呼ぶ一覧の数が出ない）。
-- 冪等: create or replace / revoke / grant。2回流しても同じ。
-- 不可逆な点: なし（関数を1つ足すだけ。表・ポリシー・データは変えない）。
--
-- ロールバック（手で流す）:
--   drop function if exists public.rpc_task_comment_counts(uuid, uuid, uuid);
-- =============================================================================

create or replace function public.rpc_task_comment_counts(
  p_space_id uuid default null,
  p_assignee_id uuid default null,
  p_org_id uuid default null
)
returns table (task_id uuid, comment_count integer)
language sql
stable
security invoker
as $$
  -- プロジェクトのタスク一覧: その space のコメント（担当者・組織の指定があれば、さらに絞る）
  select c.task_id, count(*)::integer
    from public.task_comments c
   where p_space_id is not null
     and c.space_id = p_space_id
     and c.deleted_at is null
     and (p_org_id is null or c.org_id = p_org_id)
     and (p_assignee_id is null
          or exists (select 1 from public.tasks t where t.id = c.task_id and t.assignee_id = p_assignee_id))
   group by c.task_id
  union all
  -- マイタスク: 担当のタスクのコメント（組織の指定があれば、その組織の分だけ）
  select c.task_id, count(*)::integer
    from public.tasks t
    join public.task_comments c on c.task_id = t.id
   where p_space_id is null
     and p_assignee_id is not null
     and t.assignee_id = p_assignee_id
     and (p_org_id is null or t.org_id = p_org_id)
     and c.deleted_at is null
   group by c.task_id;
$$;

comment on function public.rpc_task_comment_counts(uuid, uuid, uuid) is
  'タスクごとのコメント数（消したものを除く・0件は返さない）。呼んだ人の RLS で見えるコメントだけを数える。p_space_id と p_assignee_id が両方 null なら0行';

revoke all on function public.rpc_task_comment_counts(uuid, uuid, uuid) from public, anon;
grant execute on function public.rpc_task_comment_counts(uuid, uuid, uuid) to authenticated;
