-- =============================================================================
-- GitHub の PR・Issue の列の見える範囲（列ごとの権限）検証ハーネス: 追加スタブ
-- baseline_stubs.sql → rls_github_setup.sql → github_issues_link_setup.sql → github_visibility_setup.sql の後、
-- migration の前に流す。
--
-- Supabase の既定では、public に後から作った表には anon にも authenticated と同じ表の権限が付く
-- （20260703_000_rls_stage0_grants.sql は github_* を対象にしていないので、本番の github_* には残っている前提）。
-- 本 migration の前の状態を本番どおりに再現するため、以降の migration が作る表に anon の既定権限を付ける。
-- 既存のスタブ表（organizations / spaces / *_memberships / tasks）には付けない（本番は stage0 で外している）。
-- github_* の DDL は一切書かない。使い捨てクラスタ専用。
-- =============================================================================
set client_min_messages = warning;

grant usage on schema public to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon;
