-- Profiles table migration
-- Provides human-readable user names instead of UUIDs
--
-- This table syncs with auth.users and stores display names for users.

-- =============================================================================
-- 1) profiles テーブル
-- =============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read profiles (needed for displaying user names)
CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (for initial setup)
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =============================================================================
-- 2) Trigger: 新規ユーザー作成時に自動でprofilesレコード作成
-- =============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
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

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- 3) 既存ユーザーのprofilesレコード作成
-- =============================================================================

INSERT INTO profiles (id, display_name)
SELECT
  id,
  COALESCE(
    NULLIF(raw_user_meta_data ->> 'name', ''),
    NULLIF(raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(email, '@', 1), ''),
    phone,
    'User'  -- Final fallback
  ) as display_name
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4) updated_at 自動更新トリガー
-- =============================================================================

CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_profiles_updated_at();

-- =============================================================================
-- 5) インデックス
-- =============================================================================

CREATE INDEX IF NOT EXISTS profiles_display_name_idx ON profiles (display_name);

-- =============================================================================
-- 6) RPC: メンバー一覧取得（JOINをサーバーサイドで実行）
-- =============================================================================

-- space_memberships と profiles を JOIN してメンバー一覧を返す
-- 認証必須 + 呼び出し元が同じspaceのメンバーであることを確認
CREATE OR REPLACE FUNCTION rpc_get_space_members(p_space_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  -- 認証チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 呼び出し元がこのspaceのメンバーであることを確認
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships sm_check
    WHERE sm_check.space_id = p_space_id AND sm_check.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this space';
  END IF;

  RETURN QUERY
  SELECT
    sm.user_id,
    COALESCE(p.display_name, 'User') as display_name,
    p.avatar_url,
    sm.role
  FROM space_memberships sm
  LEFT JOIN profiles p ON p.id = sm.user_id
  WHERE sm.space_id = p_space_id;
END;
$$;

-- 権限を制限（認証ユーザーのみ実行可能）
REVOKE EXECUTE ON FUNCTION rpc_get_space_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_get_space_members(uuid) TO authenticated;
