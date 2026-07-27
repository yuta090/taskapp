-- TASK6 記事カバー画像(サムネイル)の公開バケット
-- 記事はDBのみで公開できるが、カバー画像だけ置き場が無くデプロイに縛られていた。
-- 公開バケットに置けば、記事公開と同じくデプロイ不要で画像を差し込める。
-- 書き込みは service role のみ(anon/authenticated 向けポリシーは作らない)。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task6-covers',
  'task6-covers',
  true,
  2097152, -- 2MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
