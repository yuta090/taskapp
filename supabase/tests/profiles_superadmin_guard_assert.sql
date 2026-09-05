-- =============================================================================
-- profiles.is_superadmin 権限昇格ガードの受け入れ条件。
-- 背景: 2026-09-06 に本番で「一般ユーザーが自分の is_superadmin を true に更新できる」ことを
--   ロールバック付きで確認した（RLS は「自分の行は更新可」で列の制限がなく、列 GRANT も付いていた）。
--   立てた旗はそのまま /admin 全ページ・運営 API の門番を通過する＝権限昇格。
-- 期待: 旗の変更は service role（運営 API 経由）と postgres（migration/ダッシュボード）だけ。
--   一般ユーザーの通常のプロフィール編集は今までどおり通る。
-- =============================================================================
set client_min_messages = notice;

-- 「一般ユーザー B としてアプリの API と同じ権限で実行する」ヘルパー
create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-0000000000aa';
  v_user  uuid := '00000000-0000-4000-8000-0000000000bb';
  v_new   uuid := '00000000-0000-4000-8000-0000000000cc';
  v_flag  boolean;
  v_name  text;
  v_raised boolean;
  v_n     int;
begin
  -----------------------------------------------------------------------------
  -- 1) 一般 B が自分の is_superadmin を true にする → 拒否される（本丸）
  -----------------------------------------------------------------------------
  v_raised := false;
  begin
    perform pg_temp.as_user(v_user);
    update public.profiles set is_superadmin = true where id = v_user;
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  select is_superadmin into v_flag from public.profiles where id = v_user;
  if not v_raised then raise exception '1) 一般ユーザーの is_superadmin 更新がエラーにならなかった'; end if;
  if v_flag then raise exception '1) 一般ユーザーが自分を運営にできてしまった'; end if;
  raise notice 'PASS 1) 一般ユーザーは自分の is_superadmin を立てられない';

  -----------------------------------------------------------------------------
  -- 2) 一般 B の通常のプロフィール編集（表示名）は今までどおり通る
  -----------------------------------------------------------------------------
  perform pg_temp.as_user(v_user);
  update public.profiles set display_name = '一般B改' where id = v_user;
  reset role;
  select display_name into v_name from public.profiles where id = v_user;
  if v_name <> '一般B改' then raise exception '2) 通常のプロフィール編集が通らない: %', v_name; end if;
  raise notice 'PASS 2) 通常のプロフィール編集は通る';

  -----------------------------------------------------------------------------
  -- 3) 一般 B が is_superadmin を書かずに（現状値のまま）更新 → 通る（誤検知しない）
  -----------------------------------------------------------------------------
  perform pg_temp.as_user(v_user);
  update public.profiles set is_superadmin = false, display_name = '一般B' where id = v_user;
  reset role;
  raise notice 'PASS 3) 旗が変わらない更新は通る';

  -----------------------------------------------------------------------------
  -- 4) profile 未作成の C が「自分の行を運営として新規作成」→ 拒否。false なら通る
  -----------------------------------------------------------------------------
  v_raised := false;
  begin
    perform pg_temp.as_user(v_new);
    insert into public.profiles(id, is_superadmin) values (v_new, true);
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '4) is_superadmin=true での自己 INSERT が通ってしまった'; end if;
  perform pg_temp.as_user(v_new);
  insert into public.profiles(id, display_name) values (v_new, '新規C');
  reset role;
  select is_superadmin into v_flag from public.profiles where id = v_new;
  if v_flag then raise exception '4) 新規 C が運営になっている'; end if;
  raise notice 'PASS 4) 自己 INSERT は運営旗なしのみ通る';

  -----------------------------------------------------------------------------
  -- 5) 運営 A 自身も、アプリの API 経由（authenticated）では旗を変えられない
  -----------------------------------------------------------------------------
  v_raised := false;
  begin
    perform pg_temp.as_user(v_admin);
    update public.profiles set is_superadmin = false where id = v_admin;
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '5) 運営 A が authenticated のまま旗を変えられた'; end if;
  raise notice 'PASS 5) 運営でも authenticated 経由では旗を触れない';

  -----------------------------------------------------------------------------
  -- 6) service role（運営 API が使うサービス鍵）は付与・剥奪できる
  -----------------------------------------------------------------------------
  perform set_config('role', 'service_role', true);
  update public.profiles set is_superadmin = true where id = v_user;
  update public.profiles set is_superadmin = false where id = v_user;
  reset role;
  raise notice 'PASS 6) service_role は旗を変えられる';

  -----------------------------------------------------------------------------
  -- 7) postgres（migration / ダッシュボード）も変えられる
  -----------------------------------------------------------------------------
  update public.profiles set is_superadmin = true where id = v_user;
  update public.profiles set is_superadmin = false where id = v_user;
  raise notice 'PASS 7) postgres は旗を変えられる';

  -----------------------------------------------------------------------------
  -- 8) 正規経路 rpc_admin_set_superadmin（service_role 専用・鍵付きで再確認して更新）
  -----------------------------------------------------------------------------
  -- 8a) authenticated は実行権限なし
  v_raised := false;
  begin
    perform pg_temp.as_user(v_admin);
    perform public.rpc_admin_set_superadmin(v_admin, v_user, true);
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '8a) authenticated が rpc_admin_set_superadmin を実行できた'; end if;

  -- 8b) service_role: 運営 A が B に付与 → B は運営
  perform set_config('role', 'service_role', true);
  perform public.rpc_admin_set_superadmin(v_admin, v_user, true);
  reset role;
  select is_superadmin into v_flag from public.profiles where id = v_user;
  if not v_flag then raise exception '8b) 付与が反映されていない'; end if;

  -- 8c) 自分自身の剥奪は拒否（AD001）
  v_raised := false;
  begin
    perform set_config('role', 'service_role', true);
    perform public.rpc_admin_set_superadmin(v_admin, v_admin, false);
  exception when sqlstate 'AD001' then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '8c) 自分自身の剥奪が通ってしまった'; end if;

  -- 8d) 運営でない者を actor にした呼び出しは拒否（42501）— 剥奪済みの人の遅延リクエスト対策
  v_raised := false;
  begin
    perform set_config('role', 'service_role', true);
    perform public.rpc_admin_set_superadmin(v_new, v_user, false);
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '8d) 非運営 actor の呼び出しが通ってしまった'; end if;

  -- 8e) A が B を剥奪 → 通る（A が残る）。その後 B(非運営) が A を剥奪 → 42501
  perform set_config('role', 'service_role', true);
  perform public.rpc_admin_set_superadmin(v_admin, v_user, false);
  reset role;
  select is_superadmin into v_flag from public.profiles where id = v_user;
  if v_flag then raise exception '8e) 剥奪が反映されていない'; end if;

  -- 8f) 競合の再現: A と B が同時に互いを外す。RPC は鍵で直列化され、先に通った側が相手を外し、
  --     後から来た側は actor が既に非運営なので 42501 で止まる → 運営が 0 人にならない
  perform set_config('role', 'service_role', true);
  perform public.rpc_admin_set_superadmin(v_admin, v_user, true);    -- A, B が運営
  perform public.rpc_admin_set_superadmin(v_admin, v_user, false);   -- A が B を外す（先勝ち）
  v_raised := false;
  begin
    perform public.rpc_admin_set_superadmin(v_user, v_admin, false); -- B が A を外す（後追い）
  exception when insufficient_privilege then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '8f) 後追いの剥奪が通ってしまった'; end if;
  select count(*) into v_n from public.profiles where is_superadmin;
  if v_n < 1 then raise exception '8f) 運営が 0 人になった'; end if;

  -- 8g) 存在しない target は P0002
  v_raised := false;
  begin
    perform set_config('role', 'service_role', true);
    perform public.rpc_admin_set_superadmin(v_admin, '00000000-0000-4000-8000-0000000000ee', true);
  exception when no_data_found then
    v_raised := true;
  end;
  reset role;
  if not v_raised then raise exception '8g) 存在しない target が no_data_found にならなかった'; end if;
  raise notice 'PASS 8) rpc_admin_set_superadmin: 権限・自己剥奪・非運営actor・not found';

  raise notice 'ALL PASS';
end $$;
