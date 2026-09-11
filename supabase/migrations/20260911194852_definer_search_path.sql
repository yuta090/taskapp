-- =============================================================================
-- SECURITY DEFINER の関数は search_path を固定する
--
-- 規則: SECURITY DEFINER の関数は、名前を探す場所（search_path）を関数ごとに固定して持つ。
--   拡張の関数（pgcrypto など。extensions スキーマにある）を名前だけで呼ぶ関数 … set search_path = public, extensions
--   それ以外                                                              … set search_path = public
--   変えるのは search_path だけ（alter function … set search_path）。本文・SECURITY DEFINER・実行権・持ち主は変えない。
--
-- 冪等: alter function … set search_path は何度流しても同じ。節 0 の確認は適用前と適用後のどちらの形も通す。
-- 可逆: 節 A・節 B の末尾のロールバック節（後ろの節から順に流す）。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 適用前の確認（何も変えない）
--   下の一覧と照らし、次のどれかに当たる関数があれば止める:
--     無い（引数の型まで同じ関数が public に無い）／SECURITY DEFINER でない／
--     本文が一覧の md5 と違う（下の本文を読んで search_path を決めたので、本文が違う関数には当てない）／
--     search_path が一覧の「適用前」とも「固定する値」とも違う
--   本文（md5）は migrations にある最新の定義のもの。どれも public 以外の物は修飾して呼ぶ（auth.uid() / auth.users）か、
--   拡張の関数（pgcrypto）だけを名前で呼ぶ（rpc_create_invite が呼ぶ rpc_check_org_limits は public にあり、
--   自分で search_path = public を持つ）:
--     rpc_create_invite                               20260706013754_rpc_create_invite_dedup.sql
--     rpc_get_space_members                           20240203_000_profiles.sql
--     rpc_should_show_owner_field                     20240206_000_owner_field_settings.sql
--     rpc_validate_invite                             20240103_000_auth_billing.sql
--     rpc_get_org_members                             20260223_000_rpc_get_org_members.sql
--     rpc_is_superadmin                               20260305_000_admin_superadmin.sql
--     guard_portal_visible_sections                   20260307_001_portal_sections_write_guard.sql
--     guard_agency_settings                           20260308_002_agency_settings_write_guard.sql
--     guard_task_pricing_write / _delete              20260308_003_task_pricing_write_guard.sql
--     encrypt_slack_token / decrypt_slack_token       20250213_001_slack_oauth.sql（pgp_sym_encrypt / pgp_sym_decrypt）
--     encrypt_system_secret / decrypt_system_secret   20260306_000_system_integration_configs.sql（同上）
--     rpc_validate_api_key                            20240207_001_mcp_authorization.sql（digest）
--     mcp_dry_run_delete / mcp_confirm_delete         20240207_001_mcp_authorization.sql（digest / gen_random_bytes）
--   一覧と今の形は、このセッションだけの一時ビューに置く（節 C で消す）。
--   関数を足すときは、一覧に1行・節 A か節 B に1行・そのロールバック節に1行を足す。
-- =============================================================================

-- 対象の一覧: fn（引数の型まで）/ src_md5（本文の md5）/ path_before（適用前の search_path。null = 持たない）/
--   path_after（固定する search_path）
create or replace temp view definer_search_path_targets as
select * from (values
  -- 節 A: public
  ('rpc_create_invite(uuid,uuid,text,text,uuid)', 'b6783535446e4050ec579e6a54308548', null,     'public'),
  ('rpc_get_space_members(uuid)',                 'ef8d63a9d54ddd95a76bc9ff01820048', null,     'public'),
  ('rpc_should_show_owner_field(uuid)',           'e72e57b6a2e8332be84acb11768ed917', null,     'public'),
  ('rpc_validate_invite(text)',                   'd5290a122429c62272bd345022185149', null,     'public'),
  ('rpc_get_org_members(uuid)',                   '78afaea09e75e7d6dbdbf2031572345c', null,     'public'),
  ('rpc_is_superadmin()',                         '099e64fa3f0416d61a85b09ba1f2360d', null,     'public'),
  ('guard_portal_visible_sections()',             '9800c01b9e9f9ddaef22312ccd563096', null,     'public'),
  ('guard_agency_settings()',                     '9784a7b9ec445571a25e80b57dfcc3e1', null,     'public'),
  ('guard_task_pricing_write()',                  'fd3a567491947b8f45e312eb7db7417f', null,     'public'),
  ('guard_task_pricing_delete()',                 'e3de091831b5e37a2b926eb6e5fee99c', null,     'public'),
  -- 節 A: public, extensions（pgcrypto を名前で呼ぶ）
  ('encrypt_slack_token(text,text)',              'c9f3e389f9c5312fcdfeccf4c4feac7e', null,     'public, extensions'),
  ('decrypt_slack_token(text,text)',              '2dfe45ba8e16b373fcdeeee4b4bc45c7', null,     'public, extensions'),
  ('encrypt_system_secret(text,text)',            'b75d1232907ef4f52a75ee9c2bd0403d', null,     'public, extensions'),
  ('decrypt_system_secret(text,text)',            '2dfe45ba8e16b373fcdeeee4b4bc45c7', null,     'public, extensions'),
  ('rpc_validate_api_key(text)',                  '16e8ee57f953a7689d43719264ae579c', null,     'public, extensions'),
  -- 節 B: public → public, extensions（pgcrypto を名前で呼ぶ）
  ('mcp_dry_run_delete(uuid,uuid,text,uuid[])',   '6270e9ee78ba9c60211be4b9a3da8bc8', 'public', 'public, extensions'),
  ('mcp_confirm_delete(uuid,text)',               'cf66e6e41ca110311b20938cac1c100a', 'public', 'public, extensions')
) as t(fn, src_md5, path_before, path_after);

-- 対象の今の形: kept = 変えないもの（本文の md5・SECURITY DEFINER・持ち主・実行権）/ proconfig = 変えるもの
create or replace temp view definer_search_path_state as
select t.fn,
       p.oid is not null as found,
       format('%s md5=%s definer=%s owner=%s acl=%s',
              t.fn, md5(p.prosrc), p.prosecdef, p.proowner::regrole,
              (select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) as a)) as kept,
       p.proconfig
  from pg_temp.definer_search_path_targets as t
  left join pg_catalog.pg_proc as p on p.oid = to_regprocedure('public.' || t.fn);

do $$
declare
  v_bad text;
begin
  select string_agg(t.fn, ', ' order by t.fn)
    into v_bad
    from pg_temp.definer_search_path_targets as t
    left join pg_catalog.pg_proc as p on p.oid = to_regprocedure('public.' || t.fn)
   where p.oid is null
      or not p.prosecdef
      or md5(p.prosrc) <> t.src_md5
      or not (p.proconfig is not distinct from case when t.path_before is null then null
                                                    else array['search_path=' || t.path_before] end
              or p.proconfig is not distinct from array['search_path=' || t.path_after]);

  if v_bad is not null then
    raise exception 'definer search_path: 次の関数が一覧の形と違います（無い・引数が違う・SECURITY DEFINER でない・本文が違う・search_path が想定外）: %', v_bad;
  end if;

  -- 節 C で比べるため、変えないものをこのセッションに控える
  perform set_config('definer_search_path.kept',
                     (select string_agg(s.kept, ' | ' order by s.fn) from pg_temp.definer_search_path_state as s),
                     false);
end $$;

-- ロールバック（節 0）: なし（確かめて控えるだけで、何も変えない）
-- =============================================================================
-- 節 A: search_path を持たない 15 本に、固定の search_path を持たせる
--   public             … public の表と関数だけを名前で呼ぶ関数（10 本）
--   public, extensions … pgcrypto を名前で呼ぶ関数（5 本）
-- =============================================================================

alter function public.rpc_create_invite(uuid, uuid, text, text, uuid) set search_path = public;
alter function public.rpc_get_space_members(uuid) set search_path = public;
alter function public.rpc_should_show_owner_field(uuid) set search_path = public;
alter function public.rpc_validate_invite(text) set search_path = public;
alter function public.rpc_get_org_members(uuid) set search_path = public;
alter function public.rpc_is_superadmin() set search_path = public;
alter function public.guard_portal_visible_sections() set search_path = public;
alter function public.guard_agency_settings() set search_path = public;
alter function public.guard_task_pricing_write() set search_path = public;
alter function public.guard_task_pricing_delete() set search_path = public;

alter function public.encrypt_slack_token(text, text) set search_path = public, extensions;
alter function public.decrypt_slack_token(text, text) set search_path = public, extensions;
alter function public.encrypt_system_secret(text, text) set search_path = public, extensions;
alter function public.decrypt_system_secret(text, text) set search_path = public, extensions;
alter function public.rpc_validate_api_key(text) set search_path = public, extensions;

-- ロールバック（節 A。search_path を持たない形に戻す）:
--   alter function public.rpc_create_invite(uuid, uuid, text, text, uuid) reset search_path;
--   alter function public.rpc_get_space_members(uuid) reset search_path;
--   alter function public.rpc_should_show_owner_field(uuid) reset search_path;
--   alter function public.rpc_validate_invite(text) reset search_path;
--   alter function public.rpc_get_org_members(uuid) reset search_path;
--   alter function public.rpc_is_superadmin() reset search_path;
--   alter function public.guard_portal_visible_sections() reset search_path;
--   alter function public.guard_agency_settings() reset search_path;
--   alter function public.guard_task_pricing_write() reset search_path;
--   alter function public.guard_task_pricing_delete() reset search_path;
--   alter function public.encrypt_slack_token(text, text) reset search_path;
--   alter function public.decrypt_slack_token(text, text) reset search_path;
--   alter function public.encrypt_system_secret(text, text) reset search_path;
--   alter function public.decrypt_system_secret(text, text) reset search_path;
--   alter function public.rpc_validate_api_key(text) reset search_path;
-- =============================================================================
-- 節 B: search_path = public の 2 本は pgcrypto を名前で呼ぶので、public, extensions にする
-- =============================================================================

alter function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) set search_path = public, extensions;
alter function public.mcp_confirm_delete(uuid, text) set search_path = public, extensions;

-- ロールバック（節 B。search_path = public に戻す）:
--   alter function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) set search_path = public;
--   alter function public.mcp_confirm_delete(uuid, text) set search_path = public;
-- =============================================================================
-- 節 C: 末尾の確認（何も変えない）
--   17 本の search_path が一覧の「固定する値」になっていて、本文・SECURITY DEFINER・持ち主・実行権が
--   節 0 で控えたものと同じ。違えば止める。そのあと一時ビューと控えを消す。
-- =============================================================================

do $$
declare
  v_bad text;
begin
  select string_agg(t.fn, ', ' order by t.fn)
    into v_bad
    from pg_temp.definer_search_path_targets as t
    join pg_temp.definer_search_path_state as s on s.fn = t.fn
   where not s.found
      or s.proconfig is distinct from array['search_path=' || t.path_after];

  if v_bad is not null then
    raise exception 'definer search_path: 次の関数の search_path が一覧どおりになっていません: %', v_bad;
  end if;

  if (select string_agg(s.kept, ' | ' order by s.fn) from pg_temp.definer_search_path_state as s)
     is distinct from current_setting('definer_search_path.kept', true) then
    raise exception 'definer search_path: 本文・SECURITY DEFINER・持ち主・実行権のどれかが、節 0 で控えたものと違います';
  end if;

  perform set_config('definer_search_path.kept', '', false);
end $$;

drop view pg_temp.definer_search_path_state;
drop view pg_temp.definer_search_path_targets;

-- ロールバック（節 C）: なし（確かめて片付けるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_definer_search_path.sh（全 PASS）。
--      RED=1 を付けると本 migration 抜きで流し、変わるはずの assert（chg_*）が全て落ちることを確かめられる。
--   1) 適用前（本番）: 節 0 の一覧と同じ形か（本文の md5・SECURITY DEFINER・今の search_path）を確かめ、
--      戻すときのために控える:
--        select p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig
--          from pg_proc p
--         where p.pronamespace = 'public'::regnamespace and p.proname in (<下の 17 本>) order by 1;
--   2) 適用後（本番）: 同じ問い合わせで、proconfig が節 0 の一覧の「固定する値」になっている。
--      17 本: 'rpc_create_invite', 'rpc_get_space_members', 'rpc_should_show_owner_field', 'rpc_validate_invite',
--             'rpc_get_org_members', 'rpc_is_superadmin', 'guard_portal_visible_sections', 'guard_agency_settings',
--             'guard_task_pricing_write', 'guard_task_pricing_delete', 'encrypt_slack_token', 'decrypt_slack_token',
--             'encrypt_system_secret', 'decrypt_system_secret', 'rpc_validate_api_key',
--             'mcp_dry_run_delete', 'mcp_confirm_delete'
--   3) 画面・処理: 招待を作る・招待リンクを開く／プロジェクトと組織のメンバー一覧／担当者欄の表示／
--      マスター管理画面に入る／Slack 連携・ツール連携の保存と読み出し／CLI・MCP の鍵での操作
--      （タスク削除の dry run → confirm を含む）／代理店モード・ポータルの表示設定・タスクの価格の編集
--      （権限の無い人は止まる）。
-- =============================================================================
