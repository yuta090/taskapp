-- =============================================================================
-- 適用済み migration の記録テーブル（歯抜け適用の再発防止）
--
-- 背景: 共有DBは Supabase CLI の migration 管理外で、個別に psql 適用してきた
-- 結果、未適用・部分適用が多数発生した（docs/db/MIGRATION_AUDIT_2026-07-05.md）。
-- 今後は「migration を psql で適用したら本テーブルに INSERT する」を運用規約とし、
-- 差分監査を容易にする。
--
-- 運用:
--   psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/<file>
--   psql "$SUPABASE_DB_URL" -c "insert into applied_migrations (filename) values ('<file>') on conflict do nothing;"
-- =============================================================================

create table if not exists applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now(),
  note text
);

alter table applied_migrations enable row level security;
-- 参照・書き込みとも管理用途のみ（service_role / 直接psql）。ポリシーは定義しない。

-- 2026-07-05 の棚卸し（リプレイ監査）でDBが全ファイルの最終状態と一致したことを
-- 確認済みのため、全ファイルを適用済みとして記録する。
insert into applied_migrations (filename) values
  ('20240101_000_schema.sql'),
  ('20240102_000_rpc_functions.sql'),
  ('20240103_000_auth_billing.sql'),
  ('20240202_001_api_keys.sql'),
  ('20240203_000_profiles.sql'),
  ('20240204_000_meeting_notifications.sql'),
  ('20240205_000_github_integration.sql'),
  ('20240205_000_meeting_end_trigger.sql'),
  ('20240205_001_github_security_fixes.sql'),
  ('20240206_000_minutes_parser.sql'),
  ('20240206_000_owner_field_settings.sql'),
  ('20240207_000_export_templates.sql'),
  ('20240207_001_mcp_authorization.sql'),
  ('20240208_000_task_comments.sql'),
  ('20250205_create_audit_logs.sql'),
  ('20250213_000_slack_integration.sql'),
  ('20250213_001_slack_oauth.sql'),
  ('20250213_002_org_ai_config.sql'),
  ('20250213_003_channel_id_index.sql'),
  ('20260213_000_scheduling_proposals.sql'),
  ('20260214_000_integration_connections.sql'),
  ('20260215_000_video_conference.sql'),
  ('20260216_000_scheduling_cron.sql'),
  ('20260217_000_scheduling_security_fixes.sql'),
  ('20260218_000_fix_review_open_approvals.sql'),
  ('20260219_000_preset_genre.sql'),
  ('20260219_001_add_start_date.sql'),
  ('20260219_002_add_actual_hours.sql'),
  ('20260220_000_milestone_start_date.sql'),
  ('20260221_000_apply_preset.sql'),
  ('20260222_000_notification_actioned_at.sql'),
  ('20260223_000_completed_at_tracking.sql'),
  ('20260223_000_rpc_get_org_members.sql'),
  ('20260224_000_spec_wiki_integration.sql'),
  ('20260305_000_admin_superadmin.sql'),
  ('20260306_000_system_integration_configs.sql'),
  ('20260307_000_portal_visible_sections.sql'),
  ('20260307_001_estimate_workflow.sql'),
  ('20260307_001_portal_sections_write_guard.sql'),
  ('20260308_000_agency_mode_foundation.sql'),
  ('20260308_001_task_pricing.sql'),
  ('20260308_002_agency_settings_write_guard.sql'),
  ('20260308_003_task_pricing_write_guard.sql'),
  ('20260309_000_announcements.sql'),
  ('20260310_000_multi_level_hierarchy.sql'),
  ('20260310_001_email_action_tokens.sql'),
  ('20260317_000_invite_90_days.sql'),
  ('20260702_000_perf_indexes_tasks_reviews.sql'),
  ('20260703_000_collab_notifications.sql'),
  ('20260703_000_rls_stage0_grants.sql'),
  ('20260703_001_rls_helpers.sql'),
  ('20260703_002_rls_tasks.sql'),
  ('20260703_003_rls_membership.sql'),
  ('20260703_004_rls_space_scoped.sql'),
  ('20260703_005_rls_special.sql'),
  ('20260703_006_rls_org_scoped.sql'),
  ('20260703_007_rls_parent_refs.sql'),
  ('20260703_008_rls_invites.sql'),
  ('20260703_009_rpc_authz_hardening.sql'),
  ('20260704161743_profiles_onboarding_flags.sql'),
  ('20260704161919_rpc_authz_org_invite.sql'),
  ('20260705084441_rpc_accept_invite_service_role_only.sql'),
  ('20260705133733_rpc_review_open_internal_reviewers.sql'),
  ('20260705135847_rpc_create_invite_authz.sql'),
  ('20260705140008_migration_log.sql')
on conflict (filename) do nothing;
