-- =============================================================================
-- 相手先の差し込み PR6（DB 部分）: Wiki にも書き足せるようにする
-- 確定設計: docs/spec/DOC_VOTE_SPEC.md §5・§5.1
-- 依存: 20260926145403_doc_insertions.sql・20260926153729_doc_insertions_claim.sql（本番に適用済み）
--
-- 1) 作る: Wiki 宛ての受け付けを戻す（PR5 では取り込む画面が無いので断っていた）
-- 2) 本文の確かめ（_doc_insertion_in_body）: Wiki は `"insertionId":"<番号>"` そのもので探す。相手先が本文の
--    文字に番号を書いても、反映済み・削除済みの確かめをすり抜けさせない（コードレビュー指摘）
-- 3) 削除依頼: Wiki で、その行の下に社内が字下げして書き足していたら頼めない（has_children）。
--    議事録は保存で字下げが平らになるので当てない（DOC_VOTE_SPEC §5.1）
-- 範囲: 関数1本の新設・3本の置き換えのみ。表・行は変えない。
-- =============================================================================

set lock_timeout = '3s';

-- その差し込みのブロックが、Wiki の今の本文で子（字下げした行）を持っているか。本文が JSON でなければ false
create or replace function public._doc_insertion_has_children(p_row doc_insertions)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  v_body jsonb;
begin
  if p_row.wiki_page_id is null then
    return false;
  end if;
  begin
    select w.body::jsonb into v_body from wiki_pages w where w.id = p_row.wiki_page_id;
  exception when others then
    return false;
  end;
  if v_body is null then
    return false;
  end if;
  return jsonb_path_exists(
    v_body,
    'strict $.** ? (@.props.insertionId == $id && @.children.size() > 0)',
    jsonb_build_object('id', p_row.id::text)
  );
end;
$$;

comment on function public._doc_insertion_has_children(doc_insertions) is
  '内部用: Wiki の今の本文で、その差し込みのブロックが子（字下げした行）を持っているか（削除依頼の可否）';

create or replace function public._doc_insertion_in_body(p_row doc_insertions)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when p_row.meeting_id is not null then
      exists (select 1 from meetings m where m.id = p_row.meeting_id
               and position(('<!--ins:' || p_row.id::text) in coalesce(m.minutes_md, '')) > 0)
    else
      exists (select 1 from wiki_pages w where w.id = p_row.wiki_page_id
               -- Wiki はブロックの props の目印そのもので探す（本文の文字に番号を書いても数えない。
               -- 本文は JSON.stringify の形なので空白は入らず、文字の中の " は \" になる）
               and position(('"insertionId":"' || p_row.id::text || '"') in coalesce(w.body, '')) > 0)
  end;
$$;

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
  elsif r.status = 'applied' and r.wiki_page_id is not null and public._doc_insertion_has_children(r) then
    -- Wiki で社内がその下に字下げして書き足していたら、消すと社内の文章まで道連れになるので頼めない
    raise exception 'has_children' using errcode = '22023';
  elsif r.status = 'applied' then
    update doc_insertions set status = 'remove_requested' where id = p_id;
    return 'remove_requested';
  end if;
  raise exception 'invalid_state' using errcode = '22023';
end;
$$;

revoke all on function public._doc_insertion_has_children(doc_insertions) from public, anon, authenticated, service_role;
revoke all on function public._doc_insertion_in_body(doc_insertions) from public, anon, authenticated, service_role;

reset lock_timeout;

-- =============================================================================
-- ロールバック: 3本（_doc_insertion_in_body・create・withdraw）は 20260926153729 / 20260926145403 の定義を流し直し、
--   drop function if exists public._doc_insertion_has_children(doc_insertions);
-- =============================================================================
