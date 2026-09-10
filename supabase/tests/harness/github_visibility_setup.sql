-- =============================================================================
-- GitHub 連携の見える範囲（接続した本人だけ）検証ハーネス: 追加スタブ
-- baseline_stubs.sql → rls_github_setup.sql → github_issues_link_setup.sql の後、migration の前に流す。
--
-- service_role（Webhook 受信・インストール後コールバック・照合 cron）が従来どおり全行を読めることを
-- 確かめるため、Supabase の service_role と同じく BYPASSRLS を付け、表の権限を与える
-- （以降の migration が作る表にも既定で付ける）。github_* の DDL は一切書かない。使い捨てクラスタ専用。
-- =============================================================================
set client_min_messages = warning;

alter role service_role bypassrls;

grant usage on schema public, auth to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
