-- 招待メールの文面を運営が管理画面で編集できるようにする（email_templates）
--
-- key ごとに1行。行が無ければコード既定（src/lib/email/templates/invite.ts）が使われるので、
-- 「既定に戻す」= 行削除。
--
-- アクセス境界: プラットフォーム全体の文面なので運営(superadmin)専用。
-- RLS を有効にしてポリシーを一切作らない = service role 以外は読めない・書けない。
-- 読み書きの経路は server 側（createAdminClient）に限定する:
--   読み: src/lib/email/templates/loadInviteTemplate.ts（送信時・管理画面表示）
--   書き: src/app/api/admin/email-templates/route.ts（verifySuperadmin 門番）

create table if not exists public.email_templates (
  key         text primary key
                check (key in ('invite_client', 'invite_member')),
  subject     text not null,
  heading     text not null,
  body        text not null,
  cta_label   text not null,
  note        text not null default '',
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.email_templates is
  '運営が管理画面で編集するメール文面。行が無いキーはコード既定を使う。service role 専用（RLS有効・ポリシー無し）';

alter table public.email_templates enable row level security;

-- 念のため既定 GRANT も落とす（RLS ポリシー無しでも到達させない）
revoke all on table public.email_templates from anon, authenticated;
