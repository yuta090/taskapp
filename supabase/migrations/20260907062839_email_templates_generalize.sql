-- メール文面テンプレートの汎用化（Fable 裁定 2026-09-07）
--
-- key の CHECK を「招待2キーの列挙」から「形式チェック」に緩める。
-- どのキーが有効かはコード側の台帳（src/lib/email/templates/registry.ts）が唯一の正で、
-- API が台帳外キーを 400 で拒否する。DB は形式（小文字英字と _ 、64文字以内）だけ守る。
-- それ以外（RLS 有効・ポリシー無し・service role 専用）は一切触らない。

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.email_templates'::regclass and contype = 'c'
  loop
    execute format('alter table public.email_templates drop constraint %I', c);
  end loop;
end $$;

alter table public.email_templates
  add constraint email_templates_key_format check (key ~ '^[a-z_]{1,64}$');

comment on column public.email_templates.key is
  'テンプレートのキー。有効なキーはコード側の台帳（registry.ts）が正。DB は形式だけ検査する';
