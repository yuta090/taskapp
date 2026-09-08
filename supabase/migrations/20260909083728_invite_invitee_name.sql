-- 招待した相手の名前（任意）。
-- メールアドレスだけだと保留中の一覧で誰か分からないため、招待するときに名前を添えられるようにする。
-- 書き込みは既存の招待APIから（service role）。RLS は invites の既存ポリシーのまま。
alter table public.invites
  add column if not exists invitee_name text;

comment on column public.invites.invitee_name is
  '招待した相手の名前（任意）。一覧表示とメールの宛名に使う。承諾後のプロフィール名には反映しない';
