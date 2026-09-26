-- =============================================================================
-- 相手先の差し込み PR5 の直し（コードレビュー指摘・2026-09-26）
-- 依存: 20260926145403_doc_insertions.sql（本番に適用済みなので、直しはこの migration で重ねる）
--
-- 1) 取り込む権利（rpc_doc_insertion_claim）: 本文に入れる前に、差し込み1件ごとにタブが権利を取る（2分で切れる）。
--    同時編集を使わない組織・スマホでは編集できる画面が全部取り込みに来るので、取らないと同じ行が2回入る。
--    本文にもう入っていれば（前のタブが保存して反映済みの印を立てる前に閉じた）、取らずに反映済みにする。
-- 2) 社内が採らなかった（rpc_doc_insertion_dismiss）: 取り込んだ行を社内が保存の前に消したら、状態を dismissed にして
--    閉じる（閉じないと反映待ちのまま残り、次に開いた人がまた入れる）。
-- 3) 取り消しと保存のすれ違い: 反映待ちの取り消しのとき、本文にもう入っていれば取り下げでなく削除依頼にする
--    （取り下げにすると、本文の行を誰も消さない）。
-- 4) 作る: Wiki 宛ては PR6 まで断る。反映待ち20件の上限を同時送信ですり抜けないよう順番待ちさせる。
--    名前から < も落とす（`<!--ins:番号` を名前に書いて本文確認をすり抜けさせない）。
-- 範囲: 列2つと状態1つの追加・関数2本の新設・関数2本の置き換え。既存の行は変えない。
-- =============================================================================

set lock_timeout = '3s';

alter table public.doc_insertions add column if not exists claimed_tab text null;
alter table public.doc_insertions add column if not exists claimed_until timestamptz null;

-- 状態に dismissed（社内が採らなかった）を足す
alter table public.doc_insertions drop constraint if exists doc_insertions_status_check;
alter table public.doc_insertions add constraint doc_insertions_status_check
  check (status in ('pending', 'applied', 'withdrawn', 'remove_requested', 'removed', 'dismissed'));

comment on column public.doc_insertions.claimed_tab is '本文に取り込む権利を持つタブの札（rpc_doc_insertion_claim）';
comment on column public.doc_insertions.claimed_until is '取り込む権利の期限（2分）。切れたらほかのタブが取れる';

-- -----------------------------------------------------------------------------
-- 取り込む権利
-- -----------------------------------------------------------------------------
create or replace function public.rpc_doc_insertion_claim(p_id uuid, p_tab text)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r doc_insertions%rowtype;
begin
  select * into r from doc_insertions where id = p_id for update;
  if not found
     or auth.uid() is null
     or not public.mfa_satisfied()
     or not public.app_can_write_space(r.space_id, r.org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tab is null or char_length(p_tab) = 0 or char_length(p_tab) > 100 then
    raise exception 'invalid_tab' using errcode = '22023';
  end if;
  if r.status <> 'pending' then
    return false;
  end if;
  if public._doc_insertion_in_body(r) then
    update doc_insertions set status = 'applied', applied_at = now(), applied_by = auth.uid() where id = p_id;
    return false;
  end if;
  if r.claimed_until is not null and r.claimed_until > now() and r.claimed_tab is distinct from p_tab then
    return false;
  end if;
  update doc_insertions set claimed_tab = p_tab, claimed_until = now() + interval '2 minutes' where id = p_id;
  return true;
end;
$$;

comment on function public.rpc_doc_insertion_claim(uuid, text) is
  '差し込みを本文に取り込む権利を取る（社内の編集者・1件ごと・2分）。取れたら true。本文にもう入っていれば反映済みにして false';

-- -----------------------------------------------------------------------------
-- 社内が採らなかった
-- -----------------------------------------------------------------------------
create or replace function public.rpc_doc_insertion_dismiss(p_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r doc_insertions%rowtype;
begin
  select * into r from doc_insertions where id = p_id for update;
  if not found
     or auth.uid() is null
     or not public.mfa_satisfied()
     or not public.app_can_write_space(r.space_id, r.org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.status = 'dismissed' then
    return;
  end if;
  if r.status <> 'pending' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if public._doc_insertion_in_body(r) then
    raise exception 'still_in_body' using errcode = '22023';
  end if;
  update doc_insertions set status = 'dismissed', closed_at = now() where id = p_id;
end;
$$;

comment on function public.rpc_doc_insertion_dismiss(uuid) is
  '取り込んだ差し込みを社内が保存の前に本文から消したとき、採らなかったとして閉じる（社内の編集者。本文に無いことを確かめる）';

-- -----------------------------------------------------------------------------
-- 作る・取り下げる（置き換え）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_doc_insertion_create(
  p_wiki_page_id uuid,
  p_meeting_id uuid,
  p_kind text,
  p_content text,
  p_anchor text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_space   uuid;
  v_org     uuid;
  v_content text := coalesce(p_content, '');
  v_name    text;
  v_pending int;
  v_id      uuid;
begin
  if (p_wiki_page_id is null) = (p_meeting_id is null) then
    raise exception 'exactly_one_document' using errcode = '22023';
  end if;
  -- Wiki は取り込む画面がまだ無い（PR6 で開ける）。取り込まれない反映待ちが溜まらないよう断る
  if p_wiki_page_id is not null then
    raise exception 'wiki_not_supported_yet' using errcode = '22023';
  end if;

  if p_wiki_page_id is not null then
    select w.space_id, w.org_id into v_space, v_org from wiki_pages w where w.id = p_wiki_page_id;
  else
    select m.space_id, m.org_id into v_space, v_org from meetings m where m.id = p_meeting_id;
  end if;

  -- 文書が無い・読めない・ログインしていない・二要素認証の条件を満たさないは同じ返事にする
  if v_space is null
     or v_uid is null
     or not public.mfa_satisfied()
     or not public.app_can_read_doc_source(p_wiki_page_id, p_meeting_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- 社内は本文を直接編集する（台帳を通さない）
  if public.app_is_space_internal(v_space, v_org) then
    raise exception 'internal_edits_directly' using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('paragraph', 'meeting_note') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_content ~ '^[[:space:]　]*$' then
    raise exception 'empty_content' using errcode = '22023';
  end if;
  if char_length(v_content) > 2000 then
    raise exception 'content_too_long' using errcode = '22023';
  end if;
  -- 改行のほかの制御文字は受けない
  if v_content ~ '[\x01-\x09\x0b-\x1f\x7f]' then
    raise exception 'invalid_content' using errcode = '22023';
  end if;
  -- 目印を書かせない（議事録の Markdown で本物の目印として読まれる）
  if position('<!--' in v_content) > 0 or position('-->' in v_content) > 0 then
    raise exception 'invalid_content' using errcode = '22023';
  end if;
  if p_anchor is not null and char_length(p_anchor) > 4000 then
    raise exception 'anchor_too_long' using errcode = '22023';
  end if;

  -- 反映待ちは1人×1文書20件まで（相手先が行を無制限に積めないように）。
  -- 同時に送られても超えないよう、数える前に1人×1文書で順番待ちさせる
  perform pg_advisory_xact_lock(hashtextextended(
    'doc_insertion:' || v_uid::text || ':' || coalesce(p_wiki_page_id, p_meeting_id)::text, 0));
  select count(*) into v_pending
    from doc_insertions d
   where d.author_id = v_uid
     and d.status = 'pending'
     and d.wiki_page_id is not distinct from p_wiki_page_id
     and d.meeting_id is not distinct from p_meeting_id;
  if v_pending >= 20 then
    raise exception 'too_many_pending' using errcode = '22023';
  end if;

  select left(btrim(regexp_replace(regexp_replace(coalesce(p.display_name, ''), '[<>]', '', 'g'), '[[:cntrl:]]', ' ', 'g')), 100)
    into v_name
    from profiles p where p.id = v_uid;

  insert into doc_insertions (org_id, space_id, wiki_page_id, meeting_id, kind, content, anchor, author_id, author_name)
  values (v_org, v_space, p_wiki_page_id, p_meeting_id, p_kind, v_content, p_anchor, v_uid, coalesce(v_name, ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_doc_insertion_withdraw(p_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  r doc_insertions%rowtype;
begin
  select * into r from doc_insertions where id = p_id for update;
  if not found or auth.uid() is null or r.author_id <> auth.uid() or not public.mfa_satisfied() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.status = 'pending' and public._doc_insertion_in_body(r) then
    -- 社内の画面がもう本文に入れて保存していた（反映済みの印が立つ前）。取り下げでなく消してもらう
    update doc_insertions set status = 'remove_requested' where id = p_id;
    return 'remove_requested';
  elsif r.status = 'pending' then
    update doc_insertions set status = 'withdrawn', closed_at = now() where id = p_id;
    return 'withdrawn';
  elsif r.status = 'applied' then
    update doc_insertions set status = 'remove_requested' where id = p_id;
    return 'remove_requested';
  end if;
  raise exception 'invalid_state' using errcode = '22023';
end;
$$;

revoke all on function public.rpc_doc_insertion_claim(uuid, text) from public, anon, service_role;
revoke all on function public.rpc_doc_insertion_dismiss(uuid) from public, anon, service_role;
grant execute on function public.rpc_doc_insertion_claim(uuid, text) to authenticated;
grant execute on function public.rpc_doc_insertion_dismiss(uuid) to authenticated;

reset lock_timeout;

-- =============================================================================
-- ロールバック:
--   drop function if exists public.rpc_doc_insertion_dismiss(uuid);
--   drop function if exists public.rpc_doc_insertion_claim(uuid, text);
--   create / withdraw は 20260926145403_doc_insertions.sql の定義を流し直す。
--   dismissed の行が無いことを確かめてから状態の制約を戻す。列は残してよい。
-- =============================================================================
