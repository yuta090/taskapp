-- Migration: preset_genre に 'new_business'（新規事業・サービス立ち上げ）を追加
--
-- spaces.preset_genre の CHECK 制約はジャンル名を列挙しているため、
-- コード側(src/lib/presets)にジャンルを足すときは必ずこの制約も更新する。
-- 制約を落として作り直す（既存行はすべて旧リストの値なので再検証は通る）。

ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_preset_genre_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_preset_genre_check
  CHECK (preset_genre IS NULL OR preset_genre IN (
    'web_development', 'system_development', 'design',
    'consulting', 'marketing', 'event',
    'legal_accounting', 'video_production', 'construction',
    'new_business',
    'blank'
  ));
