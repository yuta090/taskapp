-- =============================================================================
-- wiki_pages に「フォルダかどうか」の印を追加する
-- 対象テーブル: public.wiki_pages（列追加のみ・新規テーブルなし・RLS 変更なし）
-- SPEC: docs/spec/WIKI_LIST_SPEC.md「PR5: フォルダの作成・名前変更・削除・ドラッグ移動・
--       フォルダ表示の並べ替え」
-- =============================================================================
--
-- 目的:
--   PR2（20260908080457_wiki_structure.sql）で親子関係（parent_page_id）は入れたが、
--   「フォルダとして作った空のページ」と「たまたま子ページを持つ普通のページ」を
--   区別できなかった。フォルダ表示のアイコン・並べ替え（フォルダを先に出す）のため、
--   is_folder を明示の列として持つ（Notion 型＝フォルダにも本文を書ける方式は維持する。
--   「フォルダ＝ページ」なので新規テーブルは作らない）。
--
-- 既定 false・NOT NULL:
--   既存行はすべてフォルダではない通常のページなので、backfill 不要（既定値どおり）。
--
-- マルチテナント境界:
--   既存 RLS（app_can_access_space）がそのまま効く。列の中身自体は space をまたがず、
--   境界検証トリガー（enforce_wiki_page_parent）の対象でもないため、この migration は
--   トリガー・ポリシー・GRANT を一切触らない。
--
-- 冪等性:
--   列は add column if not exists。再実行しても安全。
--
-- ロールバック（不可逆）:
--   alter table public.wiki_pages drop column if exists is_folder;
--   ⚠ どのページをフォルダとして作ったかの情報は失われる（子を持つページの判別自体は
--     parent_page_id から引き続きできるので、表示上のフォールバックは効く）。
-- =============================================================================

alter table public.wiki_pages
  add column if not exists is_folder boolean not null default false;

comment on column public.wiki_pages.is_folder is
  'true ならフォルダとして作られたページ（本文も持てる Notion 型）。子ページを持つだけの通常ページと区別してアイコン・並べ替えに使う。';
