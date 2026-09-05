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
begin
  -----------------------------------------------------------------------------
  -- 1) 一般 B が自分の is_superadmin を true にする → 拒否される（本丸）
  -----------------------------------------------------------------------------
  v_raised := false;
  begin
    perform pg_temp.as_user(v_user);
    update public.profiles set is_superadmin = true where id = v_user;
  exception when others then
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
  exception when others then
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
  exception when others then
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

  raise notice 'ALL PASS';
end $$;
