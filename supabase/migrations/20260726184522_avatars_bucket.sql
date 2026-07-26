-- アバター画像用の Storage バケット + RLS
-- 実体は Storage バケット 'avatars'(公開・2MB上限・画像のみ)。
-- アバターは担当者欄・ポータル等で頻繁に表示するため、署名URLではなく公開URLで配る
-- （低機密。files機能のような非公開＋API署名方式は表示コストが高いので採らない）。
-- 書き込みは storage.objects の RLS で「本人フォルダ {uid}/... のみ」に限定する。
-- 保存パスは avatars/{auth.uid()}/<filename>。profiles.avatar_url に公開URLを保持。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2MB
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 公開バケットなので読み取りは公開URL経由(RLS非適用)。書き込み系のみポリシーを付ける。
-- いずれも bucket_id='avatars' かつ 先頭フォルダ = 自分の uid に限定（他人のアバター改竄防止）。

drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder" on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
