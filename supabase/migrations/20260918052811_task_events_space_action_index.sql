-- ダッシュボードの「確定事項」向け。決めたときの記録（SPEC_DECIDE / SPEC_IMPLEMENT）を
-- プロジェクト（space）単位で新しい順に読むための索引。
--
-- task_events には task_id と meeting_id の索引しかなく、space で絞ると全件を見にいく。
--
-- 「その2種類だけ」の部分索引にはしない。読む側は PostgREST 経由で `action = any($n)` と値を
-- 変数で投げるため、Postgres が「問い合わせの条件が索引の条件を満たす」と証明できず、索引が
-- 外れることがある。action を列として並べた索引なら、その形のままで使える。
--
-- 読む側は src/lib/hooks/useSpecDecisionEvents.ts。
-- 無くても画面は動く（遅くなるだけ）ので、コードとどちらが先に本番へ出てもよい。

create index if not exists idx_task_events_space_action_recent
  on public.task_events (space_id, action, created_at desc);
