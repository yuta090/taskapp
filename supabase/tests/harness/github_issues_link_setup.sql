-- =============================================================================
-- GitHub Issues 連携（PR1 の DB 部分）検証ハーネス: 追加スタブ
-- baseline_stubs.sql → rls_github_setup.sql の後、20260907142526_mfa_rls_enforcement.sql の前に流す。
--
-- 二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）を本番どおりに効かせるため、
-- 20260907142526 を verbatim 適用する。そのために本番では GoTrue が持つ auth.mfa_factors と
-- auth.jwt() だけを最小スタブする（形は supabase/tests/_local_bootstrap.sql と同じ）。
--   確認済み(verified)の factor を持たない利用者は mfa_satisfied() が常に true（本番と同じ判定）
--   → 社内メンバーの読み取り assert は MFA の影響を受けない。
--   aal を変えたいときは request.jwt.claims に {"aal":"aal2"} を入れる（未設定 = aal1 相当）。
-- github_* の DDL は一切書かない（実 migration を verbatim 適用して作る）。使い捨てクラスタ専用。
-- =============================================================================
set client_min_messages = warning;

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
