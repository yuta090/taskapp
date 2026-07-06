-- ファイル共有機能: files テーブル + RLS + Storage バケット
-- 実体は Storage バケット 'space-files'(非公開・50MB上限)。
-- storage.objects には一切ポリシーを付与せず、アップロード/ダウンロードは
-- API route が認可チェック後に service role で署名URLを発行する方式(認可はAPI層+本テーブルRLSに一元化)。

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  origin text not null default 'internal' check (origin in ('internal','client')),
  client_visible boolean not null default false,
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0 and size_bytes <= 52428800),
  storage_path text not null unique,
  -- pending: 署名URL発行済みでアップロード未完了 / ready: アップロード確認済み(一覧に出るのはreadyのみ)
  status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists files_space_ready_idx on public.files (space_id, status, created_at desc);
create index if not exists files_uploader_idx on public.files (uploaded_by);

alter table public.files enable row level security;

-- SELECT: 内部ロール(client/vendor以外)は自スペースの全ファイル。
--         client/vendor は client_visible または自分がアップロードしたもののみ。
create policy "space members can view files" on public.files for select using (
  exists (
    select 1 from public.space_memberships sm
    where sm.space_id = files.space_id
      and sm.user_id = auth.uid()
      and (
        sm.role not in ('client', 'vendor')
        or files.client_visible
        or files.uploaded_by = auth.uid()
      )
  )
);

-- INSERT: スペースメンバーが自分名義でのみ作成可。
--         client/vendor がアップロードする場合は origin='client' かつ client_visible=true を強制
--         (社内のみ扱いのファイルを外部ユーザーが作れないように)。
create policy "space members can insert own files" on public.files for insert with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.space_memberships sm
    where sm.space_id = files.space_id
      and sm.user_id = auth.uid()
      and (
        sm.role not in ('client', 'vendor')
        or (files.origin = 'client' and files.client_visible)
      )
  )
);

-- UPDATE(公開トグル・リネーム・status遷移): 内部ロールのみ。
-- 例外: アップローダ本人は自分のpending行をready化する必要があるため本人も許可。
create policy "internal members or uploader can update files" on public.files for update using (
  uploaded_by = auth.uid()
  or exists (
    select 1 from public.space_memberships sm
    where sm.space_id = files.space_id
      and sm.user_id = auth.uid()
      and sm.role not in ('client', 'vendor')
  )
);

-- DELETE: 内部ロール、またはアップローダ本人(クライアントの誤アップロード削除用)。
create policy "internal members or uploader can delete files" on public.files for delete using (
  uploaded_by = auth.uid()
  or exists (
    select 1 from public.space_memberships sm
    where sm.space_id = files.space_id
      and sm.user_id = auth.uid()
      and sm.role not in ('client', 'vendor')
  )
);

grant select, insert, update, delete on public.files to authenticated;

-- updated_at 自動更新(既存テーブル群と同じ方式)
create or replace function public.update_files_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_files_updated_at on public.files;
create trigger trg_files_updated_at
  before update on public.files
  for each row execute function public.update_files_updated_at();

-- Storage バケット(非公開)。storage.objects へのRLSポリシーは意図的に付与しない。
insert into storage.buckets (id, name, public, file_size_limit)
values ('space-files', 'space-files', false, 52428800)
on conflict (id) do nothing;
