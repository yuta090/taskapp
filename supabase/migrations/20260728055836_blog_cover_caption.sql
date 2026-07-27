-- 一覧サムネイル用のキャッチコピー(記事タイトルとは別の短い一言)。
-- 画像には文字を焼き込まず、テンプレートがHTMLで画像の上に重ねて表示する。
alter table blog_posts add column if not exists cover_caption text;
alter table blog_posts add constraint blog_posts_cover_caption_check
  check (cover_caption is null or char_length(cover_caption) <= 40);
