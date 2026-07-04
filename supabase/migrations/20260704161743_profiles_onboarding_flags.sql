-- profiles にオンボーディング表示済みフラグ列を追加
--
-- 目的: ウォークスルー（internal / portal）の表示済み状態を localStorage から
--       サーバー（profiles 行）へ移し、端末をまたいで一貫させる。
--
-- 契約: onboarding_flags は自由な jsonb。現時点で使用するキーは以下（いずれも boolean, 省略時は未表示扱い）:
--   - internal_walkthrough : 社内ビューのウォークスルーを表示済みなら true
--   - portal_walkthrough   : クライアントポータルのウォークスルーを表示済みなら true
-- 将来キーを増やす場合も CHECK 制約は設けず、アプリ側で解釈する。
--
-- ロールバック: この列は追加のみ（前進的・冪等）。列を DROP すれば完全に戻せるが、
--   その時点で蓄積された表示済み状態は失われる（＝再度ウォークスルーが表示され得る）。
--   データ破壊はこの「表示済み状態の消失」に限られ、他テーブルへの影響はない。

-- =============================================================================
-- 1) 列追加（冪等）
-- =============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.onboarding_flags IS
  'オンボーディング表示済みフラグ (jsonb)。キー: internal_walkthrough(boolean), portal_walkthrough(boolean)。省略キーは未表示扱い。';

-- =============================================================================
-- 2) RLS（追加ポリシーは不要）
-- =============================================================================
--
-- 既存ポリシー "Users can update own profile" は
--   FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
-- とカラム非依存で定義されているため、本人は自分の行の onboarding_flags を
-- 更新でき、他人の行は更新できない。よって本マイグレーションで追加すべき
-- ポリシーはない（org/space の分離モデルにも影響しない: profiles は
-- 認証ユーザー本人単位のスコープ）。
