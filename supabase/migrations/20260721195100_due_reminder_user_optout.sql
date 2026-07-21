-- 秘書からの期限リマインド（自動 due-reminder）を利用者個人ごとに受け取るかのオプトアウト列
-- - 参照踏襲: 20260705220354_client_reminder_emails.sql の profiles.reminder_emails_enabled
--   （クライアント向け配信オプトアウト）と同じ流儀で、内部ユーザー本人向けの受信可否列を足す。
-- - 既存行への影響なし: add column if not exists + default true のため、既存プロフィールは
--   全員 true（受け取る）で埋まる。冪等（再適用しても no-op）。
--
-- ロールバック観点:
--   本列の削除（drop column）は、その時点で false（オプトアウト）にしていたユーザーの
--   選好が失われるため事実上不可逆。前進的運用を前提とし、drop はしない想定。

alter table public.profiles
  add column if not exists due_reminder_enabled boolean not null default true;

comment on column public.profiles.due_reminder_enabled is
  '秘書からの期限リマインド(自動due-reminder)を本人が受け取るか。false=オプトアウト。default true。sender が送信直前に参照し、false なら suppressed(recipient_opted_out)。';

-- =============================================================================
-- RLS（追加ポリシーは不要）
-- =============================================================================
--
-- 既存ポリシー "Users can update own profile"（20240203_000_profiles.sql）は
--   FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
-- とカラム非依存で定義されているため、本人は自分の行の due_reminder_enabled を
-- 更新でき（設定トグル）、他人の行は更新できない。SELECT も既存
--   "Profiles are viewable by authenticated users"（auth.role() = 'authenticated'）
-- で本人が自分の行を読める。よって本マイグレーションで追加すべきポリシーはない。
-- （profiles は認証ユーザー本人単位のスコープであり、org/space の分離モデルには
-- 影響しない。先行の reminder_emails_enabled / onboarding_flags と同じ扱い。）
