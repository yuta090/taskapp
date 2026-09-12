-- =============================================================================
-- 招待は、その人の組織の役割と合う種類だけ（RC-1 を招待にもそろえる）
-- 確定設計: Fable 裁定 2026-09-12（組織の役割と space の役割の整合）＋2026-09-12 の運用判断
--
-- 規則:
--   招待の種類 … 社内＝role 'member'／相手先＝role 'client'・'vendor'（組織の役割は社内＝owner / member、相手先＝client）。
--   invites に足す決まり（作るとき・有効な承諾待ちの招待の org_id / space_id / メール / 役割 / token / 期限を
--   書き換えるときに確かめる。承諾済み・期限切れの行と、取り消し〈行の削除〉は確かめない）:
--     1. すでにその組織に入っている人（メールで突き合わせ）の組織の役割と、招待の種類が合うこと
--     2. 同じ組織・同じメールに、種類の違う有効な承諾待ちの招待が無いこと（同じ種類なら今までどおり）
--     3. 協力会社（vendor）の招待は、代理店モードの space だけ（rpc_update_space_member_role と同じ決まり）
--   断るときの符号（画面・道具はこれを見て日本語の 409 にする）:
--     SQLSTATE IRC01 / message invite_org_role_conflict          … 1 に反する（DETAIL: org_role=… invite_role=…）
--     SQLSTATE IRC02 / message invite_pending_kind_conflict      … 2 に反する（DETAIL: invite_role=…）
--     SQLSTATE IRC03 / message invite_vendor_requires_agency_mode … 3 に反する（DETAIL: space_id=…）
--   rpc_create_invite … 使い回し（同じ宛先の有効な承諾待ちの期限を延ばして同じリンクを返す）は「同じ役割」の
--     招待だけ。「既にそのorgのメンバー」の確認を使い回しより前に行う（招待を出したあとに参加した人の
--     古いリンクを延ばして返さないため）。ほかの振る舞い・引数・戻り値・実行権は変えない。
--   トリガーは service role からの書き込み（CLI / MCP の道具・まとめて作る経路・再送）にも効く。
--   トリガー関数は SECURITY DEFINER（書いた人の見え方に関係なく、利用者・組織のメンバー・招待・space を読む）・
--     search_path = public。トリガー専用なので、直接は実行させない。
--
-- ロック: 先頭で invites を share row exclusive で押さえてから変える（トリガーを作るのはこれで足りる。読みは止めない。
--   途中で強いロックに上げない）。待つのは 3 秒まで。取れなければ全体を取り消すので、流し直す。
--   トリガーは drop trigger を使わず、無いときだけ作る（drop trigger if exists は、トリガーが無くても表を
--   access exclusive で押さえるため）。DO 文の中で取る（空の DB から順に流す確認はトランザクションで包まないため。
--   本番の適用は1トランザクションなので、ロックは最後まで持つ）。
-- 前提: 今の有効な承諾待ちの招待が規則を満たしている（満たさない行が1つでもあれば、末尾の確認で止まる）。
-- 冪等: create or replace function・トリガーは無いときだけ作る・実行権は同じ形に置き直す。2回流しても同じ。
--   トリガーの定義を変えるときは、別の migration で作り直す（本 migration を流し直しても、すでにあるトリガーは変えない）。
-- 可逆: 節 1〜2 の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: ロックと、作り直す関数の土台の確認（何も変えない）
-- =============================================================================

do $$
begin
  set local lock_timeout = '3s';
  lock table public.invites in share row exclusive mode;
end $$;

-- rpc_create_invite の今の本文が、土台（20260706013754_rpc_create_invite_dedup.sql）か本 migration の本文であること。
--   代理店モードの列（spaces.agency_mode）があること。違えば止める
do $$
declare
  v_bad text := '';
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_create_invite(uuid,uuid,text,text,uuid)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];
  if v_md5 is null or v_md5 not in ('b6783535446e4050ec579e6a54308548', '984a6717b09c9743a083de0c662abc0f') then
    v_bad := v_bad || format(' rpc_create_invite の定義（md5=%s）;', coalesce(v_md5, 'なし'));
  end if;

  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.spaces'::regclass and a.attname = 'agency_mode' and not a.attisdropped
  ) then
    v_bad := v_bad || ' spaces.agency_mode が無い;';
  end if;

  if v_bad <> '' then
    raise exception 'invite role consistency: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（ロックはトランザクションの終わりで外れる。確認は何も変えない）
-- =============================================================================
-- 節 1: 招待は、その人の組織の役割と合う種類だけ（トリガー）
-- =============================================================================

create or replace function public.enforce_invite_role_consistency()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_email    text    := lower(trim(new.email));
  v_internal boolean := (new.role = 'member');   -- 社内の招待か（相手先は client / vendor）
  v_org_role text;
begin
  -- 承諾済み・期限切れの行は確かめない（承諾する・期限切れにする書き換えと、取り消し〈行の削除〉は今までどおり）
  if new.accepted_at is not null or new.expires_at <= now() then
    return new;
  end if;

  -- 3. 協力会社（vendor）の招待は、代理店モードの space だけ
  if new.role = 'vendor' and not exists (
    select 1 from public.spaces s where s.id = new.space_id and s.agency_mode
  ) then
    raise exception 'invite_vendor_requires_agency_mode' using errcode = 'IRC03',
      detail = format('space_id=%s', new.space_id);
  end if;

  -- 1. すでにその組織に入っている人は、組織の役割と招待の種類が合うことだけ（メールで突き合わせる）
  select om.role into v_org_role
    from auth.users u
    join public.org_memberships om on om.user_id = u.id and om.org_id = new.org_id
   where lower(u.email) = v_email
   limit 1;

  if v_org_role is not null and v_internal <> (v_org_role <> 'client') then
    raise exception 'invite_org_role_conflict' using errcode = 'IRC01',
      detail = format('org_role=%s invite_role=%s', v_org_role, new.role);
  end if;

  -- 2. 同じ組織・同じメールに、種類の違う有効な承諾待ちの招待が無いこと
  if exists (
    select 1
      from public.invites i
     where i.id is distinct from new.id
       and i.org_id = new.org_id
       and lower(i.email) = v_email
       and i.accepted_at is null
       and i.expires_at > now()
       and (i.role = 'member') <> v_internal
  ) then
    raise exception 'invite_pending_kind_conflict' using errcode = 'IRC02',
      detail = format('invite_role=%s', new.role);
  end if;

  return new;
end;
$$;

comment on function public.enforce_invite_role_consistency() is
  '招待は、その人の組織の役割と合う種類だけ（社内=member / 相手先=client・vendor）。vendor は代理店モードの space だけ';

-- トリガー専用。直接は実行させない（トリガーとしての実行には実行権は要らない）
revoke all on function public.enforce_invite_role_consistency() from public, anon, authenticated, service_role;

-- 無いときだけ作る（drop trigger は使わない。トリガーが無くても表を access exclusive で押さえるため）
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.invites'::regclass
       and tgname = 'trg_enforce_invite_role_consistency'
       and not tgisinternal
  ) then
    create trigger trg_enforce_invite_role_consistency
      before insert or update of org_id, space_id, email, role, token, expires_at on public.invites
      for each row
      execute function public.enforce_invite_role_consistency();
  end if;
end $$;

-- ロールバック（節 1。後ろの節を戻したあとに流す）:
--   drop trigger if exists trg_enforce_invite_role_consistency on public.invites;
--   drop function if exists public.enforce_invite_role_consistency();
-- =============================================================================
-- 節 2: rpc_create_invite … 使い回しは同じ役割だけ・「既にメンバー」の確認を先に
--   土台: 20260706013754_rpc_create_invite_dedup.sql（節 0 で md5 を確かめ済み）。
--   引数・戻り値・実行権・ほかの確かめ（本人として呼ぶ・招待できる役割・人数枠・90日）は変えない。
-- =============================================================================

create or replace function public.rpc_create_invite(
  p_org_id uuid,
  p_space_id uuid,
  p_email text,
  p_role text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_invite_id uuid;
  v_limits jsonb;
  v_actor uuid;
  v_normalized_email text;
  v_existing_invite record;
  v_existing_member_user_id uuid;
  v_new_expires_at timestamptz;
begin
  v_normalized_email := lower(trim(p_email));

  -- Security: caller must be authenticated and act as themselves
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if v_actor <> p_created_by then
    raise exception 'Not authorized: p_created_by must be the authenticated user';
  end if;

  -- Security: org owner, or (org member and space admin/editor) — API層と整合
  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
    union
    select 1
    from org_memberships om
    join space_memberships sm
      on sm.space_id = p_space_id and sm.user_id = v_actor and sm.role in ('admin', 'editor')
    where om.org_id = p_org_id and om.user_id = v_actor and om.role = 'member'
  ) then
    raise exception 'Not authorized to create invites';
  end if;

  -- Validate role
  if p_role not in ('client', 'member') then
    raise exception 'Invalid role: %', p_role;
  end if;

  -- 宛先が既にそのorgのメンバーなら拒否（使い回しより前に確かめる: 招待を出したあとにその組織へ参加した人の
  -- 古いリンクを、期限だけ延ばして返さないため）
  select u.id into v_existing_member_user_id
  from auth.users u
  where lower(u.email) = v_normalized_email;

  if v_existing_member_user_id is not null and exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_existing_member_user_id
  ) then
    raise exception 'already a member';
  end if;

  -- Idempotent resend: 同じ宛先・同じ役割の有効な保留招待が既にあれば延長して返す（新規カウントしない）。
  -- 役割が違う保留招待は使い回さない（種類が違えばトリガーが断る・同じ種類で役割だけ違うなら新しく作る）
  select * into v_existing_invite
  from invites
  where org_id = p_org_id
    and space_id = p_space_id
    and lower(email) = v_normalized_email
    and role = p_role
    and accepted_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    v_new_expires_at := now() + interval '90 days';

    update invites
    set expires_at = v_new_expires_at
    where id = v_existing_invite.id;

    return jsonb_build_object(
      'invite_id', v_existing_invite.id,
      'token', v_existing_invite.token,
      'expires_at', v_new_expires_at::text
    );
  end if;

  -- Check limits (新規招待の場合のみ)
  v_limits := rpc_check_org_limits(p_org_id);

  if p_role = 'client' then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit. Please upgrade your plan.';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit. Please upgrade your plan.';
    end if;
  end if;

  -- Generate token
  v_token := gen_random_uuid()::text;

  -- Create invite (90 days expiry)
  insert into invites (org_id, space_id, email, role, token, expires_at, created_by)
  values (p_org_id, p_space_id, v_normalized_email, p_role, v_token, now() + interval '90 days', p_created_by)
  returning id into v_invite_id;

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'expires_at', (now() + interval '90 days')::text
  );
end;
$$;

revoke execute on function public.rpc_create_invite(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.rpc_create_invite(uuid, uuid, text, text, uuid) to authenticated, service_role;

-- ロールバック（節 2。土台の本文に戻す。search_path と実行権は今と同じ）:
--   create or replace function rpc_create_invite(
--     p_org_id uuid,
--     p_space_id uuid,
--     p_email text,
--     p_role text,
--     p_created_by uuid
--   )
--   returns jsonb
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     v_token text;
--     v_invite_id uuid;
--     v_limits jsonb;
--     v_actor uuid;
--     v_normalized_email text;
--     v_existing_invite record;
--     v_existing_member_user_id uuid;
--     v_new_expires_at timestamptz;
--   begin
--     v_normalized_email := lower(trim(p_email));
--   
--     -- Security: caller must be authenticated and act as themselves
--     v_actor := auth.uid();
--     if v_actor is null then
--       raise exception 'Authentication required';
--     end if;
--     if v_actor <> p_created_by then
--       raise exception 'Not authorized: p_created_by must be the authenticated user';
--     end if;
--   
--     -- Security: org owner, or (org member and space admin/editor) — API層と整合
--     if not exists (
--       select 1 from org_memberships
--       where org_id = p_org_id and user_id = v_actor and role = 'owner'
--       union
--       select 1
--       from org_memberships om
--       join space_memberships sm
--         on sm.space_id = p_space_id and sm.user_id = v_actor and sm.role in ('admin', 'editor')
--       where om.org_id = p_org_id and om.user_id = v_actor and om.role = 'member'
--     ) then
--       raise exception 'Not authorized to create invites';
--     end if;
--   
--     -- Validate role
--     if p_role not in ('client', 'member') then
--       raise exception 'Invalid role: %', p_role;
--     end if;
--   
--     -- Idempotent resend: 同一宛先への有効な保留招待が既にあれば延長して返す（新規カウントしない）
--     select * into v_existing_invite
--     from invites
--     where org_id = p_org_id
--       and space_id = p_space_id
--       and lower(email) = v_normalized_email
--       and accepted_at is null
--       and expires_at > now()
--     order by created_at desc
--     limit 1;
--   
--     if found then
--       v_new_expires_at := now() + interval '90 days';
--   
--       update invites
--       set expires_at = v_new_expires_at
--       where id = v_existing_invite.id;
--   
--       return jsonb_build_object(
--         'invite_id', v_existing_invite.id,
--         'token', v_existing_invite.token,
--         'expires_at', v_new_expires_at::text
--       );
--     end if;
--   
--     -- 宛先が既にそのorgのメンバーなら拒否
--     select u.id into v_existing_member_user_id
--     from auth.users u
--     where lower(u.email) = v_normalized_email;
--   
--     if v_existing_member_user_id is not null and exists (
--       select 1 from org_memberships
--       where org_id = p_org_id and user_id = v_existing_member_user_id
--     ) then
--       raise exception 'already a member';
--     end if;
--   
--     -- Check limits (新規招待の場合のみ)
--     v_limits := rpc_check_org_limits(p_org_id);
--   
--     if p_role = 'client' then
--       if not (v_limits->'clients'->>'can_add')::boolean then
--         raise exception 'Organization has reached client limit. Please upgrade your plan.';
--       end if;
--     else
--       if not (v_limits->'members'->>'can_add')::boolean then
--         raise exception 'Organization has reached member limit. Please upgrade your plan.';
--       end if;
--     end if;
--   
--     -- Generate token
--     v_token := gen_random_uuid()::text;
--   
--     -- Create invite (90 days expiry)
--     insert into invites (org_id, space_id, email, role, token, expires_at, created_by)
--     values (p_org_id, p_space_id, v_normalized_email, p_role, v_token, now() + interval '90 days', p_created_by)
--     returning id into v_invite_id;
--   
--     return jsonb_build_object(
--       'invite_id', v_invite_id,
--       'token', v_token,
--       'expires_at', (now() + interval '90 days')::text
--     );
--   end;
--   $$;
--   revoke execute on function public.rpc_create_invite(uuid, uuid, text, text, uuid) from public, anon;
--   grant execute on function public.rpc_create_invite(uuid, uuid, text, text, uuid) to authenticated, service_role;
-- =============================================================================
-- 節 3: 末尾の確認（何も変えない）… トリガーが有効・トリガー関数と rpc_create_invite が本 migration の本文で
--   SECURITY DEFINER・search_path = public・実行権が想定どおり・今の有効な承諾待ちの招待が規則を満たしている。
--   違えば止める。実行権は public / anon / authenticated / service_role の順。
-- =============================================================================

do $$
declare
  v_bad  text := '';
  v_text text;
  v_n    bigint;
begin
  -- トリガー: 有効（O）。決めた列の insert / update の前に、行ごとに動く
  select format('%s:%s', t.tgenabled::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF org_id, space_id, email, role, token, expires_at'
                                               ' ON public.invites FOR EACH ROW EXECUTE FUNCTION %enforce_invite_role_consistency()')::text)
    into v_text
    from pg_trigger t
   where t.tgrelid = 'public.invites'::regclass
     and t.tgname = 'trg_enforce_invite_role_consistency'
     and not t.tgisinternal;
  if v_text is distinct from 'O:true' then
    v_bad := v_bad || ' トリガー: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- トリガー関数: 本 migration の本文・誰も直接は実行できない
  select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.enforce_invite_role_consistency()');
  if v_text is distinct from 'ddd6b1dcfa657e1ec7a2e5cb73efa3a3:true:search_path=public:false/false/false/false' then
    v_bad := v_bad || ' トリガー関数: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- rpc_create_invite: 本 migration の本文・実行権は今までどおり（authenticated と service_role）
  select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    into v_text
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_create_invite(uuid,uuid,text,text,uuid)');
  if v_text is distinct from '984a6717b09c9743a083de0c662abc0f:true:search_path=public:false/false/true/true' then
    v_bad := v_bad || ' rpc_create_invite: ' || coalesce(v_text, '(なし)') || ';';
  end if;

  -- 今の行: 有効な承諾待ちの招待のうち、規則に合わない物が 0
  with p as (select * from public.invites where accepted_at is null and expires_at > now())
  select (select count(*) from p
            join auth.users u on lower(u.email) = lower(p.email)
            join public.org_memberships om on om.org_id = p.org_id and om.user_id = u.id
           where (p.role = 'member') <> (om.role <> 'client'))
       + (select count(*) from p
           where exists (select 1 from p q
                          where q.id <> p.id and q.org_id = p.org_id and lower(q.email) = lower(p.email)
                            and (q.role = 'member') <> (p.role = 'member')))
       + (select count(*) from p join public.spaces s on s.id = p.space_id
           where p.role = 'vendor' and not s.agency_mode)
    into v_n;
  if v_n > 0 then
    v_bad := v_bad || format(' 規則に合わない承諾待ちの招待=%s;', v_n);
  end if;

  if v_bad <> '' then
    raise exception 'invite role consistency: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 3）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_invite_role_consistency.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 次の3つが 0 件（0 件でなければ節 3 で止まる）。rpc_create_invite の今の本文が土台と同じ
--      （md5 = b6783535446e4050ec579e6a54308548）:
--        with p as (select * from public.invites where accepted_at is null and expires_at > now())
--        select count(*) from p join auth.users u on lower(u.email) = lower(p.email)
--          join public.org_memberships om on om.org_id = p.org_id and om.user_id = u.id
--         where (p.role = 'member') <> (om.role <> 'client');
--        with p as (select * from public.invites where accepted_at is null and expires_at > now())
--        select count(*) from p where exists (select 1 from p q where q.id <> p.id and q.org_id = p.org_id
--          and lower(q.email) = lower(p.email) and (q.role = 'member') <> (p.role = 'member'));
--        select count(*) from public.invites i join public.spaces s on s.id = i.space_id
--         where i.accepted_at is null and i.expires_at > now() and i.role = 'vendor' and not s.agency_mode;
--   2) 適用後（本番）: 節 3 が通る。
--   3) 画面・処理: 招待を作る（社内・相手先）／同じ宛先にもう一度送ると同じリンクの期限が延びる／
--      すでに参加している人には「既にメンバーです」／種類の違う承諾待ちがあると断られる（画面・道具の文言は別 PR）。
-- =============================================================================
