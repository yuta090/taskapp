-- CLI / API からも投票（OK・NG・保留）を押せるようにする
--
-- rpc_doc_vote_cast は auth.uid()・app_can_read_doc_poll（中で auth.uid() を見る）に頼っているため、
-- 鍵で動く道具（service_role・ログイン中の利用者を持たない）からは呼べない。
--
-- このリポジトリの決まりどおり、本体を `_impl`（実行者を引数で受け取る）に出し、
-- 画面用（`auth.uid()` を渡す）と道具用（`_as`・実行者を明示）の2つで包む。
-- 20260916041200_review_cancel_as.sql と同じ形。
--
-- ⚠ PR3（ポータル対応）が app_can_read_doc_poll(poll) を広げ、相手先も読める・押せるようにする予定
-- （app_can_read_doc_poll 自体はこの migration では変えない）。ぶつからないよう、
-- 「押してよいか」の判定は本体(_doc_vote_cast_impl)に持たせず、画面用・道具用それぞれの
-- 包みの側で行う:
--   rpc_doc_vote_cast    … これまでどおり app_can_read_doc_poll(p_poll_id) + mfa_satisfied() を確かめる
--                           （20260926083057_doc_polls.sql の本文と、確かめる条件・順番も一切変えていない）
--   rpc_doc_vote_cast_as … 社内メンバーだけ（_actor_is_space_internal を使う _actor_can_read_doc_poll）。
--                           相手先はまだ API キーを持てないため、これで十分
-- 本体(_doc_vote_cast_impl)は、判定済みの前提で書き込みだけを行う（poll の行は reason_required の
-- 判定に使うので引き続き読む）。1人1票・理由必須・履歴の追記・同時押しの advisory lock は変えていない。
--
-- 二要素認証（mfa_satisfied）の確かめは、もとの rpc_pass_ball 等の _as と同じく、
-- 道具経由では行わない（20260912134823_mcp_rpc_as.sql の7本もこの確かめを持たない）。

-- =============================================================================
-- 節 0: 置き換える物の土台の確認（何も変えない）
--
-- 画面用(rpc_doc_vote_cast)は今の本文の写しなので、当てる先の現物が写し元と同じでなければ止める。
-- 2回流しても止まらないよう、適用後の姿（本体を呼ぶだけの形）も通す。
-- =============================================================================
do $$
declare
  v_md5 text;
begin
  set local lock_timeout = '3s';

  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_doc_vote_cast(uuid,text,text)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];

  if v_md5 is null or v_md5 not in (
    'f614861ac2fc46974fe1e30756e9568d',  -- 土台（20260926083057_doc_polls.sql の本文）
    '01419ba137ad68d5c3113a43987ea301'   -- 本 migration 適用後（判定はそのまま・書き込みだけ _doc_vote_cast_impl に出す）
  ) then
    raise exception '中止: rpc_doc_vote_cast の今の定義が写し元と違います（md5=%）。本体を写し直してから当ててください',
      coalesce(v_md5, 'なし');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1) _actor_is_space_internal: app_is_space_internal と同じ判定を、呼んだ人ではなく p_actor で
--    20260912134823_mcp_rpc_as.sql の _actor_can_write_space と対（org_memberships / space_memberships を直接見る）
-- -----------------------------------------------------------------------------
create or replace function public._actor_is_space_internal(p_actor uuid, p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- app_is_space_internal(p_space, p_org) と同じ判定を、呼んだ人（auth.uid()）ではなく p_actor で行う:
  --   space がその組織のもの・p_actor が組織の社内（owner / admin / member）・
  --   その space の役割が client / vendor でない（役割が無ければ editor 扱い。viewer を含む）
  select exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
     and exists (select 1 from public.org_memberships m
                  where m.org_id = p_org and m.user_id = p_actor and m.role in ('owner', 'admin', 'member'))
     and coalesce((select sm.role from public.space_memberships sm
                    where sm.space_id = p_space and sm.user_id = p_actor), 'editor') not in ('client', 'vendor');
$$;

comment on function public._actor_is_space_internal(uuid, uuid, uuid) is
  'app_is_space_internal と同じ判定を p_actor で行う（_as 系のRPCが使う）。外からは呼べない';

revoke execute on function public._actor_is_space_internal(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) _actor_can_read_doc_poll: rpc_doc_vote_cast_as（社内メンバーだけ）が使う判定。
--    app_can_read_doc_poll とは別物（PR3 が app_can_read_doc_poll を広げても、この関数は変わらない。
--    相手先はまだ API キーを持てないため、道具用は社内だけで足りる）
-- -----------------------------------------------------------------------------
create or replace function public._actor_can_read_doc_poll(p_actor uuid, p_poll uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from doc_polls p
    where p.id = p_poll
      and public._actor_is_space_internal(p_actor, p.space_id, p.org_id)
  );
$$;

comment on function public._actor_can_read_doc_poll(uuid, uuid) is
  'rpc_doc_vote_cast_as が使う判定（社内メンバーだけ）。app_can_read_doc_poll とは別物。外からは呼べない';

revoke execute on function public._actor_can_read_doc_poll(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) 本体: _doc_vote_cast_impl（書き込みだけ。判定は呼び出し元の包みが済ませている前提）
-- -----------------------------------------------------------------------------
create or replace function public._doc_vote_cast_impl(
  p_actor uuid,
  p_poll_id uuid,
  p_choice text,
  p_memo text default ''
)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid  uuid := p_actor;
  v_memo text := coalesce(p_memo, '');
  v_poll doc_polls%rowtype;
  v_old  doc_votes%rowtype;
begin
  -- 「押してよいか」は呼び出し元（rpc_doc_vote_cast / rpc_doc_vote_cast_as）が確かめ済み。
  -- ここでは poll の行を reason_required の判定用に読むだけ（無ければ何かがおかしいので forbidden）。
  select * into v_poll from doc_polls where id = p_poll_id;
  if not found or v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 同じ人が同じ投票へほぼ同時に送ったとき、1本ずつ順に処理する（rpc_doc_vote_cast と同じ理由）
  perform pg_advisory_xact_lock(hashtextextended('doc_vote:' || p_poll_id::text || ':' || v_uid::text, 0));

  if p_choice is null then
    delete from doc_votes where poll_id = p_poll_id and user_id = v_uid returning * into v_old;
    if found then
      insert into doc_vote_events (poll_id, user_id, action, choice, memo)
      values (p_poll_id, v_uid, 'retract', null, '');
    end if;
    return null;
  end if;

  if p_choice not in ('ok', 'ng', 'hold') then
    raise exception 'invalid_choice' using errcode = '22023';
  end if;
  if char_length(v_memo) > 2000 then
    raise exception 'memo_too_long' using errcode = '22023';
  end if;
  -- 空白・改行・全角空白だけのメモは「書いていない」とみなす
  if v_poll.reason_required = 'ng_hold'
     and p_choice in ('ng', 'hold')
     and v_memo ~ '^[[:space:]　]*$' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_old from doc_votes where poll_id = p_poll_id and user_id = v_uid for update;
  if found then
    if v_old.choice = p_choice and v_old.memo = v_memo then
      return p_choice;
    end if;
    update doc_votes
       set choice = p_choice, memo = v_memo, updated_at = now()
     where poll_id = p_poll_id and user_id = v_uid;
    insert into doc_vote_events (poll_id, user_id, action, choice, memo)
    values (p_poll_id, v_uid, 'change', p_choice, v_memo);
  else
    insert into doc_votes (poll_id, user_id, choice, memo)
    values (p_poll_id, v_uid, p_choice, v_memo);
    insert into doc_vote_events (poll_id, user_id, action, choice, memo)
    values (p_poll_id, v_uid, 'cast', p_choice, v_memo);
  end if;

  return p_choice;
end;
$$;

comment on function public._doc_vote_cast_impl(uuid, uuid, text, text) is
  'rpc_doc_vote_cast / rpc_doc_vote_cast_as の書き込み本体。判定は済んでいる前提（呼び出し元が確かめる）。外からは呼べない';

revoke execute on function public._doc_vote_cast_impl(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4) 画面用: rpc_doc_vote_cast（判定は今までどおり。書き込みだけ _doc_vote_cast_impl に出す）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_doc_vote_cast(
  p_poll_id uuid,
  p_choice text,
  p_memo text default ''
)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- 20260926083057_doc_polls.sql の本文と同じ3条件・同じ順番（PR3 が app_can_read_doc_poll を
  -- 広げても、ここは書き直さずにそのまま効く）
  if auth.uid() is null
     or not public.app_can_read_doc_poll(p_poll_id)
     or not public.mfa_satisfied() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public._doc_vote_cast_impl(auth.uid(), p_poll_id, p_choice, p_memo);
end;
$$;

comment on function public.rpc_doc_vote_cast(uuid, text, text) is
  '投票ブロックで押す（ok / ng / hold）・選び直す・取り消す（p_choice = null）。判定はここ・書き込みは _doc_vote_cast_impl（DOC_VOTE_SPEC §4）';

revoke all on function public.rpc_doc_vote_cast(uuid, text, text) from public, anon;
grant execute on function public.rpc_doc_vote_cast(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5) 道具用: rpc_doc_vote_cast_as（CLI / API / AI秘書。鍵に紐づく利用者を実行者に。社内メンバーだけ）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_doc_vote_cast_as(
  p_actor uuid,
  p_poll_id uuid,
  p_choice text,
  p_memo text default ''
)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_actor is null or not public._actor_can_read_doc_poll(p_actor, p_poll_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public._doc_vote_cast_impl(p_actor, p_poll_id, p_choice, p_memo);
end;
$$;

comment on function public.rpc_doc_vote_cast_as(uuid, uuid, text, text) is
  'rpc_doc_vote_cast の道具用。実行者(p_actor)は呼び出し側（鍵の利用者）が渡す。社内メンバーだけ。service_role専用';

revoke execute on function public.rpc_doc_vote_cast_as(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_doc_vote_cast_as(uuid, uuid, text, text) to service_role;

-- =============================================================================
-- 節 9: 実行権が意図どおりか、その場で確かめる
-- =============================================================================
do $$
declare
  v_bad text := '';
begin
  if has_function_privilege('anon', 'public._actor_is_space_internal(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._actor_is_space_internal(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public._actor_is_space_internal(uuid,uuid,uuid)', 'execute') then
    v_bad := v_bad || ' 本体(_actor_is_space_internal)に実行権が残っている;';
  end if;

  if has_function_privilege('anon', 'public._actor_can_read_doc_poll(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._actor_can_read_doc_poll(uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public._actor_can_read_doc_poll(uuid,uuid)', 'execute') then
    v_bad := v_bad || ' 本体(_actor_can_read_doc_poll)に実行権が残っている;';
  end if;

  if has_function_privilege('anon', 'public._doc_vote_cast_impl(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._doc_vote_cast_impl(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('service_role', 'public._doc_vote_cast_impl(uuid,uuid,text,text)', 'execute') then
    v_bad := v_bad || ' 本体(_doc_vote_cast_impl)に実行権が残っている;';
  end if;

  if has_function_privilege('anon', 'public.rpc_doc_vote_cast_as(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.rpc_doc_vote_cast_as(uuid,uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.rpc_doc_vote_cast_as(uuid,uuid,text,text)', 'execute') then
    v_bad := v_bad || ' 道具用(rpc_doc_vote_cast_as)は service_role だけのはず;';
  end if;

  if has_function_privilege('anon', 'public.rpc_doc_vote_cast(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.rpc_doc_vote_cast(uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.rpc_doc_vote_cast(uuid,text,text)', 'execute') then
    v_bad := v_bad || ' 画面用(rpc_doc_vote_cast)は authenticated と service_role のはず;';
  end if;

  if v_bad <> '' then
    raise exception '中止: 実行権が意図と違います:%', v_bad;
  end if;
end $$;

-- 適用後の確認:
--   1. Wiki・議事録の投票ボタン（画面）がこれまでどおり動く（社内・読むだけの人を含む）。
--   2. `agentpm vote cast` で押すと、doc_vote_events.user_id が鍵の持ち主になる。
--   3. authenticated が rpc_doc_vote_cast_as を呼ぶと権限エラーになる。
--   4. 相手先の役割・別 space の p_actor では、道具からも拒否される（_actor_is_space_internal の歯止め）。
--   5. PR3 が app_can_read_doc_poll を広げたあと、画面（rpc_doc_vote_cast）はそのまま新しい範囲で動く
--      （この migration を作り直す必要はない）。
--
-- ロールバック（画面用の関数を土台の本文に戻し、道具用と本体・判定用の新関数を外す）:
--   -- 20260926083057_doc_polls.sql の rpc_doc_vote_cast 本文をそのまま CREATE OR REPLACE で当て直す
--   drop function if exists public.rpc_doc_vote_cast_as(uuid, uuid, text, text);
--   drop function if exists public._doc_vote_cast_impl(uuid, uuid, text, text);
--   drop function if exists public._actor_can_read_doc_poll(uuid, uuid);
--   drop function if exists public._actor_is_space_internal(uuid, uuid, uuid);
-- =============================================================================
