-- ファイルに説明文(description)を追加する。
-- 一覧でファイル名だけでは何のファイルか分からないため、行に短い説明を出せるようにする。
-- 可視性は既存の files RLS にそのまま従う(列単位の追加ポリシーは不要)。

alter table public.files
  add column if not exists description text
    check (description is null or char_length(description) <= 1000);
