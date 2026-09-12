-- meeting_participants に created_by（参加者を登録した人）列を足す。
--
-- なぜ: 日程調整の確定（rpc_confirm_proposal_slot。最新の定義は 20260911143112_space_role_boundary.sql）と
-- 画面の会議作成（src/lib/hooks/useMeetings.ts）が、参加者を created_by 付きで書き込んでいた。
-- ところが表には created_by 列が無く（20240101_000_schema.sql から一度も足されていない）、
-- どちらも本番で失敗していた（2026-09-12 に本番の表定義で確認）。
-- 関数の本体を書き直すより、書き込み側が前提にしている列を足すほうが変更が小さく、
-- 他のストリームが同じ関数を直していても衝突しない。
--
-- 既存の行は NULL のまま（誰が登録したか分からない）。既定値はログイン中の利用者。
-- 画面（useMeetings）は created_by を送らず、この既定値に任せる（ブラウザから他人を登録者にさせないため）。
-- service role からの書き込み（API の meeting_create など）では auth.uid() が NULL になり、そのまま NULL が入る。

-- auth.users への外部キーを足すと auth.users にも一瞬ロック（SHARE ROW EXCLUSIVE）がかかる。
-- 待ち続けて他の処理を止めないよう、取れなければ諦める（落ちたら流し直す）。
set local lock_timeout = '3s';

alter table public.meeting_participants
  add column if not exists created_by uuid default auth.uid() references auth.users (id) on delete set null;

comment on column public.meeting_participants.created_by is '参加者を登録した利用者（不明な過去分は NULL）';

-- PostgREST（Supabase の自動 API）に新しい列を知らせる
notify pgrst, 'reload schema';

-- ロールバック:
--   alter table public.meeting_participants drop column if exists created_by;
--   notify pgrst, 'reload schema';
