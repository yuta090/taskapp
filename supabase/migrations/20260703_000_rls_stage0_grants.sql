-- =============================================================================
-- RLS Rollout Stage 0 — 権限ハードニング
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md
--
-- 目的: RLS ポリシー整備(Stage 1)の前に、最悪の露出を即時・低リスク・可逆で封鎖する。
--   1) anon（公開キー）から全テナントテーブルの権限を剥奪
--      （公開ページはこれらを直読みせず、anon経路は SECURITY DEFINER RPC 経由のため影響なし）
--   2) authenticated から TRUNCATE/REFERENCES/TRIGGER を剥奪
--      （TRUNCATE は RLS では防げないため、行レベル制御を入れても別途剥奪が必須）
--
-- 影響: authenticated 経由のアプリ挙動は不変。service_role(API) は無関係。
-- 可逆: 末尾のロールバック節参照（GRANT を戻すだけ）。
-- 注意: これは「未認証の公開露出」と「TRUNCATE破壊」を閉じる。
--       ログイン済みユーザーの越境(IDOR)は Stage 1(RLSポリシー) で閉じる。
-- =============================================================================

do $$
declare
  t text;
  tenant_tables text[] := array[
    'tasks','organizations','org_memberships','space_memberships','spaces','invites',
    'reviews','review_approvals','milestones','meetings','meeting_participants',
    'meeting_transcripts','meeting_drafts','notifications','task_owners','task_pricing',
    'task_events','task_relations','task_publications','milestone_publications',
    'wiki_pages','wiki_page_versions','wiki_page_publications','space_groups',
    'discussion_items','discussion_comments','onboarding_progress','org_billing',
    'mcp_confirm_tokens','llm_runs'
  ];
begin
  foreach t in array tenant_tables loop
    -- テーブルが存在する場合のみ実行（冪等・環境差異に安全）
    if to_regclass('public.'||t) is not null then
      -- anon は一切アクセス不可に
      execute format('revoke all privileges on table public.%I from anon', t);
      -- authenticated から RLS で防げない/不要な権限を剥奪（SELECT/INSERT/UPDATE/DELETE は残す）
      execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- plans は課金プランの参照マスタ。参照は許可、書き込みは剥奪。
do $$
begin
  if to_regclass('public.plans') is not null then
    -- 参照は anon/authenticated ともに可（非機微・/pricing 等で使用の可能性）
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.plans from anon';
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.plans from authenticated';
    -- select は明示的に付与（既にあれば冪等）
    execute 'grant select on table public.plans to anon, authenticated';
  end if;
end $$;

-- =============================================================================
-- ロールバック（必要時に手動実行）:
--   Supabase では通常 anon/authenticated に対し public テーブルへ GRANT されている。
--   元に戻す場合の例:
--     grant select, insert, update, delete on table public.<table> to authenticated;
--     grant select, insert, update, delete on table public.<table> to anon;   -- 非推奨（露出に戻る）
--   ※ Stage 0 の意図は anon 露出の封鎖なので、anon への再GRANTは基本行わない。
-- =============================================================================
