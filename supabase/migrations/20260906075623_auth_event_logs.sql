-- =============================================================================
-- auth_event_logs: ログイン（OAuthコールバック）失敗の記録
--
-- 目的: /auth/callback で起きた失敗を「どの段階で・どんな理由で」まで残し、
--   管理画面（/admin/logs）から見られるようにする。Google ログインの設定不備
--   （合鍵違い・戻り先未登録など）は Supabase が error_code 付きで戻してくるが、
--   これまでアプリ側で捨てて一律「キャンセル」と表示していたため原因追跡ができなかった。
--
-- stage の値（アプリ側 src/lib/auth/authEventLog.ts と一致させる）:
--   provider_callback : Supabase/Google から error 付きで戻ってきた（合鍵違い・access_denied 等）
--   missing_code      : code も error も無く戻ってきた
--   code_exchange     : exchangeCodeForSession が失敗（flow state 不一致等）
--   session_user      : セッション確立後に user が取れなかった
--   landing           : 着地先判定（membership 参照）で例外
--
-- 書き込み・読み取りは service role のみ（best-effort 記録・失敗してもログイン動線を止めない）。
--   RLS を有効化し policy を置かない ＝ anon/authenticated からは不可視。
-- =============================================================================

create table if not exists public.auth_event_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  stage text not null,
  provider text,
  error_code text,
  error_description text,
  user_id uuid,
  email text,
  ip text,
  user_agent text,
  metadata jsonb
);

comment on table public.auth_event_logs is
  'OAuthコールバック(/auth/callback)の失敗記録。段階(stage)と理由(error_code/description)を残す。service roleのみ。';
comment on column public.auth_event_logs.stage is
  'provider_callback | missing_code | code_exchange | session_user | landing';
comment on column public.auth_event_logs.error_code is
  'Supabase/Google が返した error_code（例 unexpected_failure, access_denied）。';

-- 管理画面は新しい順に一覧するだけ。
create index if not exists idx_auth_event_logs_occurred
  on public.auth_event_logs (occurred_at desc);

alter table public.auth_event_logs enable row level security;
-- policy は置かない（service role のみ）。

-- =============================================================================
-- ロールバック:
--   drop table if exists public.auth_event_logs;
-- =============================================================================
