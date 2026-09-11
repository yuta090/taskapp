-- =============================================================================
-- SECURITY DEFINER の関数は、呼ぶ役割だけが実行できる
--
-- 規則:
--   節 A  次の 22 本は、ログインした人（authenticated）とサーバー（service_role）だけが実行できる。
--   節 B  app_is_space_vendor は、持ち主の権限で動く関数の中からだけ呼ぶ。実行できるのは service_role だけ
--         （ポリシーから直接使うときは、その migration で authenticated に grant する）。
--   次の2本はログイン前にも使うので、この migration では変えない（ログインしていない人も実行できる）:
--     mfa_pre_request（API の毎回の前処理）・rpc_validate_invite（招待ページ）
--   変えるのは実行権だけ。本文・持ち主・SECURITY DEFINER・search_path は変えない。
--
-- 冪等: revoke → grant。2回流しても同じ。
-- 可逆: 節 A・節 B の末尾のロールバック節（後ろの節から順に流す）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 適用前の確認（何も変えない）
--   対象の 23 本と、変えない 2 本が、引数の型まで同じ形で public にあり、SECURITY DEFINER であること。違えば止める。
--   一覧は、このセッションだけの一時ビューに置く（節 C で消す）。
-- =============================================================================

-- 一覧: kind = user（節 A）/ owner（節 B）/ keep（変えない）
create or replace temp view definer_anon_execute_targets as
select * from (values
  -- 節 A: ポリシーが呼ぶ補助関数
  ('app_can_access_space(uuid,uuid)',                          'user'),
  ('app_is_org_internal(uuid)',                                'user'),
  ('app_is_org_member(uuid)',                                  'user'),
  ('app_is_space_member(uuid)',                                'user'),
  ('app_task_visible_to_caller(uuid,uuid,text,text)',          'user'),
  ('mfa_satisfied()',                                          'user'),
  -- 節 A: ログイン中の画面・サーバー（本人のセッション）から呼ぶ関数
  ('rpc_apply_preset_to_space(uuid,text,jsonb,jsonb,boolean)', 'user'),
  ('rpc_decide_considering(uuid,text,text,text,uuid,uuid)',    'user'),
  ('rpc_get_minutes_preview(uuid,text)',                       'user'),
  ('rpc_get_org_members(uuid)',                                'user'),
  ('rpc_get_space_members(uuid)',                              'user'),
  ('rpc_meeting_end(uuid)',                                    'user'),
  ('rpc_meeting_start(uuid)',                                  'user'),
  ('rpc_parse_meeting_minutes(uuid,text)',                     'user'),
  ('rpc_pass_ball(uuid,text,uuid[],uuid[],text,uuid)',         'user'),
  ('rpc_review_approve(uuid,uuid)',                            'user'),
  ('rpc_review_block(uuid,text,uuid)',                         'user'),
  ('rpc_review_cancel(uuid)',                                  'user'),
  ('rpc_review_open(uuid,uuid[],uuid)',                        'user'),
  ('rpc_set_spec_state(uuid,text,uuid,text)',                  'user'),
  -- 節 A: 今は呼び出し元が無い関数
  ('rpc_invoke_meeting_minutes_email(uuid)',                   'user'),
  ('rpc_is_superadmin()',                                      'user'),
  -- 節 B
  ('app_is_space_vendor(uuid)',                                'owner'),
  -- 変えない
  ('mfa_pre_request()',                                        'keep'),
  ('rpc_validate_invite(text)',                                'keep')
) as t(fn, kind);

do $$
declare
  v_bad text;
begin
  select string_agg(t.fn, ', ' order by t.fn)
    into v_bad
    from pg_temp.definer_anon_execute_targets as t
    left join pg_catalog.pg_proc as p on p.oid = to_regprocedure('public.' || t.fn)
   where p.oid is null
      or not p.prosecdef;

  if v_bad is not null then
    raise exception 'definer anon execute: 次の関数が見つからないか、SECURITY DEFINER ではありません: %', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 節 A: 次の 22 本は、ログインした人とサーバーだけが実行できる
-- =============================================================================

-- ポリシーが呼ぶ補助関数
revoke execute on function public.app_can_access_space(uuid, uuid) from public, anon;
grant execute on function public.app_can_access_space(uuid, uuid) to authenticated, service_role;

revoke execute on function public.app_is_org_internal(uuid) from public, anon;
grant execute on function public.app_is_org_internal(uuid) to authenticated, service_role;

revoke execute on function public.app_is_org_member(uuid) from public, anon;
grant execute on function public.app_is_org_member(uuid) to authenticated, service_role;

revoke execute on function public.app_is_space_member(uuid) from public, anon;
grant execute on function public.app_is_space_member(uuid) to authenticated, service_role;

revoke execute on function public.app_task_visible_to_caller(uuid, uuid, text, text) from public, anon;
grant execute on function public.app_task_visible_to_caller(uuid, uuid, text, text) to authenticated, service_role;

revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- ログイン中の画面・サーバー（本人のセッション）から呼ぶ関数
revoke execute on function public.rpc_apply_preset_to_space(uuid, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.rpc_apply_preset_to_space(uuid, text, jsonb, jsonb, boolean) to authenticated, service_role;

revoke execute on function public.rpc_decide_considering(uuid, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.rpc_decide_considering(uuid, text, text, text, uuid, uuid) to authenticated, service_role;

revoke execute on function public.rpc_get_minutes_preview(uuid, text) from public, anon;
grant execute on function public.rpc_get_minutes_preview(uuid, text) to authenticated, service_role;

revoke execute on function public.rpc_get_org_members(uuid) from public, anon;
grant execute on function public.rpc_get_org_members(uuid) to authenticated, service_role;

revoke execute on function public.rpc_get_space_members(uuid) from public, anon;
grant execute on function public.rpc_get_space_members(uuid) to authenticated, service_role;

revoke execute on function public.rpc_meeting_end(uuid) from public, anon;
grant execute on function public.rpc_meeting_end(uuid) to authenticated, service_role;

revoke execute on function public.rpc_meeting_start(uuid) from public, anon;
grant execute on function public.rpc_meeting_start(uuid) to authenticated, service_role;

revoke execute on function public.rpc_parse_meeting_minutes(uuid, text) from public, anon;
grant execute on function public.rpc_parse_meeting_minutes(uuid, text) to authenticated, service_role;

revoke execute on function public.rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) from public, anon;
grant execute on function public.rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) to authenticated, service_role;

revoke execute on function public.rpc_review_approve(uuid, uuid) from public, anon;
grant execute on function public.rpc_review_approve(uuid, uuid) to authenticated, service_role;

revoke execute on function public.rpc_review_block(uuid, text, uuid) from public, anon;
grant execute on function public.rpc_review_block(uuid, text, uuid) to authenticated, service_role;

revoke execute on function public.rpc_review_cancel(uuid) from public, anon;
grant execute on function public.rpc_review_cancel(uuid) to authenticated, service_role;

revoke execute on function public.rpc_review_open(uuid, uuid[], uuid) from public, anon;
grant execute on function public.rpc_review_open(uuid, uuid[], uuid) to authenticated, service_role;

revoke execute on function public.rpc_set_spec_state(uuid, text, uuid, text) from public, anon;
grant execute on function public.rpc_set_spec_state(uuid, text, uuid, text) to authenticated, service_role;

-- 今は呼び出し元が無い関数
revoke execute on function public.rpc_invoke_meeting_minutes_email(uuid) from public, anon;
grant execute on function public.rpc_invoke_meeting_minutes_email(uuid) to authenticated, service_role;

revoke execute on function public.rpc_is_superadmin() from public, anon;
grant execute on function public.rpc_is_superadmin() to authenticated, service_role;

-- ロールバック（節 A。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   grant execute on function public.app_can_access_space(uuid, uuid) to public, anon;
--   grant execute on function public.app_is_org_internal(uuid) to public, anon;
--   grant execute on function public.app_is_org_member(uuid) to public, anon;
--   grant execute on function public.app_is_space_member(uuid) to public, anon;
--   grant execute on function public.app_task_visible_to_caller(uuid, uuid, text, text) to public, anon;
--   grant execute on function public.mfa_satisfied() to anon;
--   grant execute on function public.rpc_apply_preset_to_space(uuid, text, jsonb, jsonb, boolean) to public, anon;
--   grant execute on function public.rpc_decide_considering(uuid, text, text, text, uuid, uuid) to public, anon;
--   grant execute on function public.rpc_get_minutes_preview(uuid, text) to public, anon;
--   grant execute on function public.rpc_get_org_members(uuid) to anon;
--   grant execute on function public.rpc_get_space_members(uuid) to anon;
--   grant execute on function public.rpc_meeting_end(uuid) to public, anon;
--   grant execute on function public.rpc_meeting_start(uuid) to public;
--   grant execute on function public.rpc_parse_meeting_minutes(uuid, text) to public, anon;
--   grant execute on function public.rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) to public;
--   grant execute on function public.rpc_review_approve(uuid, uuid) to public;
--   grant execute on function public.rpc_review_block(uuid, text, uuid) to public;
--   grant execute on function public.rpc_review_cancel(uuid) to public;
--   grant execute on function public.rpc_review_open(uuid, uuid[], uuid) to public;
--   grant execute on function public.rpc_set_spec_state(uuid, text, uuid, text) to public;
--   grant execute on function public.rpc_invoke_meeting_minutes_email(uuid) to public, anon;
--   grant execute on function public.rpc_is_superadmin() to anon;
-- =============================================================================
-- 節 B: app_is_space_vendor は、持ち主の権限で動く関数の中からだけ呼ぶ（service_role は今のまま）
-- =============================================================================

revoke execute on function public.app_is_space_vendor(uuid) from public, anon, authenticated;

-- ロールバック（節 B。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   grant execute on function public.app_is_space_vendor(uuid) to public, anon, authenticated;
-- =============================================================================
-- 節 C: 末尾の確認（何も変えない）
--   節 A の 22 本: PUBLIC と anon は実行できず、authenticated と service_role は実行できる
--   節 B の 1 本: PUBLIC・anon・authenticated は実行できず、service_role は実行できる
--   変えない 2 本: anon が実行できる
--   違えば止める（別の付与者から付いた実行権が残っているときなど）。そのあと一時ビューを消す。
-- =============================================================================

do $$
declare
  v_bad text;
begin
  select string_agg(t.fn, ', ' order by t.fn)
    into v_bad
    from pg_temp.definer_anon_execute_targets as t
    cross join lateral (select to_regprocedure('public.' || t.fn) as oid) as f
   where case t.kind
           when 'user' then has_function_privilege('public', f.oid, 'execute')
                         or has_function_privilege('anon', f.oid, 'execute')
                         or not has_function_privilege('authenticated', f.oid, 'execute')
                         or not has_function_privilege('service_role', f.oid, 'execute')
           when 'owner' then has_function_privilege('public', f.oid, 'execute')
                          or has_function_privilege('anon', f.oid, 'execute')
                          or has_function_privilege('authenticated', f.oid, 'execute')
                          or not has_function_privilege('service_role', f.oid, 'execute')
           when 'keep' then not has_function_privilege('anon', f.oid, 'execute')
         end;

  if v_bad is not null then
    raise exception 'definer anon execute: 次の関数の実行権が想定と違います: %', v_bad;
  end if;
end $$;

drop view pg_temp.definer_anon_execute_targets;

-- ロールバック（節 C）: なし（確かめて片付けるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: scripts/verify-migrations-from-scratch.sh（検査3: anon が実行できる SECURITY DEFINER の関数は、
--      許容リスト supabase/tests/allowlist/anon_definer_functions.txt の2本だけ）。
--   1) 適用前（本番）: 戻すときのために今の実行権を控える:
--        select p.oid::regprocedure, p.proacl from pg_proc p
--         where p.pronamespace = 'public'::regnamespace
--           and p.oid in (select to_regprocedure('public.' || fn) from (values <節 0 の一覧の 25 本>) v(fn)) order by 1;
--   2) 適用後（本番）: anon が実行できる SECURITY DEFINER の関数（トリガー関数を除く）が2本だけ:
--        select p.oid::regprocedure from pg_proc p
--         where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
--           and has_function_privilege('anon', p.oid, 'execute') order by 1;
--          → mfa_pre_request()・rpc_validate_invite(text)
--   3) 画面: ログインしてのタスク一覧・会議・承認・プロジェクトと組織のメンバー一覧・テンプレートの適用が
--      今までどおり動く。ログイン前の招待ページが開ける。
-- =============================================================================
