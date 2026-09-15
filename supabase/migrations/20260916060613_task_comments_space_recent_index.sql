-- =============================================================================
-- ダッシュボードの「最近のコメント」を、コメントが増えても速く出すための索引
--
-- 目的:
--   ダッシュボード（src/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient.tsx）に
--   最近コメントのあったタスクを出す。取得は src/lib/hooks/useRecentTaskComments.ts の
--     task_comments .eq('space_id') .is('deleted_at', null) .order('created_at', desc) .limit(100)
--   既存の索引は space_id だけ・created_at だけの別々の2本なので、space で絞ってから新しい順に並べるには
--   その space のコメントを全部読んでから並べ替えることになる。task_comments の RLS は行ごとに関数を呼ぶため
--   （20260915103640_task_comment_counts.sql の実測: コメント8,000件の space で1.2〜2秒）、読む行数がそのまま遅さになる。
--   (space_id, created_at desc) の索引なら、新しい順に読み始めて上限の件数で止まる。
--
-- 対応:
--   消していないコメントだけの部分索引を1本足す（取得の条件 deleted_at is null と合わせてある）。
--
-- 適用の順番: どちらが先でもよい（索引が無くても画面は動く。コメントが多い space で遅くなるだけ）。
-- ロック: create index は作り終えるまで task_comments への書き込みを待たせる（読み取りは待たせない）。
--   本番は 2026-09-16 時点で2行なので一瞬で終わる。migration はトランザクションの中で流すので concurrently は使えない。
-- 冪等: if not exists。2回流しても同じ。
-- 不可逆な点: なし（索引を1本足すだけ。表・ポリシー・データは変えない）。
--
-- ロールバック（手で流す）: 索引 public.idx_task_comments_space_recent を消す
-- =============================================================================

create index if not exists idx_task_comments_space_recent
  on public.task_comments (space_id, created_at desc)
  where deleted_at is null;
