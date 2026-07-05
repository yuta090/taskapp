-- 本番で on_auth_user_created トリガーの実体が消失していた復元 migration。
-- 20240203_000_profiles.sql に定義は記録されているが実体が無く、新規登録ユーザーの
-- profiles 行が作成されない不具合が 2026-07-06 のUXウォークスルーで発覚した。

-- =============================================================================
-- 1) トリガー関数の再作成（20240203_000_profiles.sql と同一ロジック）
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(split_part(NEW.email, '@', 1), ''),
      NEW.phone,
      'User'  -- Final fallback to prevent NOT NULL violation
    )
  )
  ON CONFLICT (id) DO UPDATE
  SET display_name = COALESCE(
    NULLIF(EXCLUDED.display_name, ''),
    profiles.display_name,
    'User'
  );
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2) トリガーの再作成
-- =============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 3) 冪等バックフィル: トリガー消失期間中に profiles が作られなかったユーザーを補完
-- =============================================================================

INSERT INTO public.profiles (id, display_name)
SELECT
  id,
  COALESCE(
    NULLIF(raw_user_meta_data ->> 'name', ''),
    NULLIF(raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(email, '@', 1), ''),
    phone,
    'User'
  ) as display_name
FROM auth.users
ON CONFLICT (id) DO NOTHING;
