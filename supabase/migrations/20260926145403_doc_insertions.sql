-- =============================================================================
-- 相手先の差し込み PR5（DB 部分）: 差し込みの台帳 doc_insertions と関数4本
-- 確定設計: docs/spec/DOC_VOTE_SPEC.md §5・§5.1（Fable 裁定 2026-09-26）
-- 依存: 20260926134407_doc_polls_client.sql（app_can_read_doc_source）,
--       20260911143112_space_role_boundary.sql（app_is_space_internal / app_can_write_space）,
--       20260911155718_space_org_fk.sql, 20260907142526_mfa_rls_enforcement.sql（mfa_satisfied）
--
-- 目的: 相手先（ポータル）が議事録・Wiki に「普通の行」と「メモ」を書き足せるようにする。
--   サーバーは本文（minutes_md / body）も updated_at も触らない。差し込みはこの台帳に「反映待ち」で置き、
--   本文に入れるのは社内の編集画面（同時編集中は書記のタブ）。入れて保存したら「反映済み」にする。
--
--   doc_insertions                    差し込み1件（誰が・いつ・何を・どこに）
--   rpc_doc_insertion_create          作る（その文書を読める相手先。社内は本文を直接編集するので不可）
--   rpc_doc_insertion_mark_applied    反映済みにする（社内の編集者。本文に目印が入ったことを DB で確かめる）
--   rpc_doc_insertion_mark_removed    削除済みにする（社内の編集者。本文から目印が消えたことを DB で確かめる）
--   rpc_doc_insertion_withdraw        取り下げ・削除依頼（本人だけ）
--
-- 状態: pending → applied（反映済み）/ pending → withdrawn（取り下げ）/ applied → remove_requested → removed
-- 読み: 社内は文書の分を全部、相手先は自分の行だけ。書き込みは関数だけ（authenticated に insert/update/delete なし）
-- 目印（本文の中）: 議事録 `<!--ins:<id> <kind> <日時> <名前>-->本文`、Wiki は docInsertion ブロックの props.insertionId。
--   反映済み・削除済みの判定は、本文にこの id の文字列があるか（uuid は乱数なので部分一致で誤らない）。
-- 本文に `<!--` と `-->` を書かせない（議事録の Markdown で本物の目印＝タスク化・投票などとして読まれるため）。
--
-- 範囲: 新しい表1つ・関数4つ・ポリシー・索引のみ。既存の表・関数は変えない。
-- 冪等: create table / index if not exists、drop policy if exists → create policy、create or replace function。
-- 破壊的変更: なし。可逆: 末尾のロールバック節（表を消すと台帳も消える）。
-- =============================================================================

set lock_timeout = '3s';

create table if not exists public.doc_insertions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  space_id       uuid not null,
  wiki_page_id   uuid null references public.wiki_pages(id) on delete cascade,
  meeting_id     uuid null references public.meetings(id) on delete cascade,
  -- paragraph = 普通の行 / meeting_note = メモ（会議メモと同じ帯）
  kind           text not null check (kind in ('paragraph', 'meeting_note')),
  content        text not null check (char_length(content) between 1 and 2000),
  -- どこの後ろに足すか。Wiki はブロックの id、議事録はその行（最上位のブロック）の Markdown。null は末尾
  anchor         text null check (anchor is null or char_length(anchor) <= 4000),
  status         text not null default 'pending'
                 check (status in ('pending', 'applied', 'withdrawn', 'remove_requested', 'removed')),
  -- 足す場所が見つからず末尾に付けたとき true（直前にその行が書き換えられていた）
  anchor_missed  boolean not null default false,
  author_id      uuid not null references auth.users(id) on delete cascade,
  -- 本文に添える名前。作った時点のプロフィールの表示名（目印を壊す > と改行は落とす）
  author_name    text not null default '',
  created_at     timestamptz not null default now(),
  applied_at     timestamptz null,
  applied_by     uuid null references auth.users(id) on delete set null,
  closed_at      timestamptz null,
  constraint doc_insertions_one_document check ((wiki_page_id is null) <> (meeting_id is null)),
  constraint doc_insertions_space_org_fkey foreign key (space_id, org_id)
    references public.spaces (id, org_id) on delete cascade
);

create index if not exists doc_insertions_meeting_idx on public.doc_insertions (meeting_id, status) where meeting_id is not null;
create index if not exists doc_insertions_wiki_idx on public.doc_insertions (wiki_page_id, status) where wiki_page_id is not null;
create index if not exists doc_insertions_author_idx on public.doc_insertions (author_id, status);

comment on table public.doc_insertions is
  '相手先が議事録・Wiki に足した行・メモの台帳。本文へ入れるのは社内の編集画面（DOC_VOTE_SPEC §5）。書くのは rpc_doc_insertion_* だけ';

alter table public.doc_insertions enable row level security;
revoke all on table public.doc_insertions from public, anon, authenticated;
grant select on table public.doc_insertions to authenticated;

drop policy if exists doc_insertions_select on public.doc_insertions;
create policy doc_insertions_select on public.doc_insertions
  for select to authenticated
  using (
    author_id = (select auth.uid())
    or public.app_is_space_internal(space_id, org_id)
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'doc_insertions' and policyname = 'mfa_required_when_enrolled'
  ) then
    create policy mfa_required_when_enrolled on public.doc_insertions as restrictive for all to authenticated
      using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 作る
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

  -- 反映待ちは1人×1文書20件まで（相手先が行を無制限に積めないように）
  select count(*) into v_pending
    from doc_insertions d
   where d.author_id = v_uid
     and d.status = 'pending'
     and d.wiki_page_id is not distinct from p_wiki_page_id
     and d.meeting_id is not distinct from p_meeting_id;
  if v_pending >= 20 then
    raise exception 'too_many_pending' using errcode = '22023';
  end if;

  select left(btrim(regexp_replace(replace(coalesce(p.display_name, ''), '>', ''), '[[:cntrl:]]', ' ', 'g')), 100)
    into v_name
    from profiles p where p.id = v_uid;

  insert into doc_insertions (org_id, space_id, wiki_page_id, meeting_id, kind, content, anchor, author_id, author_name)
  values (v_org, v_space, p_wiki_page_id, p_meeting_id, p_kind, v_content, p_anchor, v_uid, coalesce(v_name, ''))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.rpc_doc_insertion_create(uuid, uuid, text, text, text) is
  '相手先が議事録・Wiki に行・メモを足す（台帳に反映待ちで置く）。文書を読める社内でない人だけ。本文・目印の検査と、1人×1文書20件の上限あり（DOC_VOTE_SPEC §5.1）';

-- -----------------------------------------------------------------------------
-- 反映済みにする / 削除済みにする（社内の編集者。本文に目印があるか・無いかを確かめる）
-- -----------------------------------------------------------------------------
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
               and position(p_row.id::text in coalesce(w.body, '')) > 0)
  end;
$$;

comment on function public._doc_insertion_in_body(doc_insertions) is
  '内部用: その差し込みの目印が今の本文にあるか（mark_applied / mark_removed が使う）';

create or replace function public.rpc_doc_insertion_mark_applied(p_id uuid, p_anchor_missed boolean default false)
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
  if r.status = 'applied' then
    return; -- 二度呼ばれても同じ（保存のあとに何度確かめてもよい）
  end if;
  if r.status <> 'pending' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if not public._doc_insertion_in_body(r) then
    raise exception 'not_in_body' using errcode = '22023';
  end if;
  update doc_insertions
     set status = 'applied', applied_at = now(), applied_by = auth.uid(),
         anchor_missed = coalesce(p_anchor_missed, false)
   where id = p_id;
end;
$$;

comment on function public.rpc_doc_insertion_mark_applied(uuid, boolean) is
  '差し込みを反映済みにする（社内の編集者。本文に目印が入っていることを確かめる。二度呼んでも同じ）';

create or replace function public.rpc_doc_insertion_mark_removed(p_id uuid)
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
  if r.status = 'removed' then
    return;
  end if;
  if r.status <> 'remove_requested' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if public._doc_insertion_in_body(r) then
    raise exception 'still_in_body' using errcode = '22023';
  end if;
  update doc_insertions set status = 'removed', closed_at = now() where id = p_id;
end;
$$;

comment on function public.rpc_doc_insertion_mark_removed(uuid) is
  '削除依頼の差し込みを削除済みにする（社内の編集者。本文から目印が消えたことを確かめる）';

-- -----------------------------------------------------------------------------
-- 取り下げ・削除依頼（本人だけ）
-- -----------------------------------------------------------------------------
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
  if r.status = 'pending' then
    update doc_insertions set status = 'withdrawn', closed_at = now() where id = p_id;
    return 'withdrawn';
  elsif r.status = 'applied' then
    update doc_insertions set status = 'remove_requested' where id = p_id;
    return 'remove_requested';
  end if;
  raise exception 'invalid_state' using errcode = '22023';
end;
$$;

comment on function public.rpc_doc_insertion_withdraw(uuid) is
  '自分の差し込みを取り下げる（反映待ち）・消してもらう（反映済み→削除依頼）。本人だけ';

revoke all on function public.rpc_doc_insertion_create(uuid, uuid, text, text, text) from public, anon, service_role;
revoke all on function public.rpc_doc_insertion_mark_applied(uuid, boolean) from public, anon, service_role;
revoke all on function public.rpc_doc_insertion_mark_removed(uuid) from public, anon, service_role;
revoke all on function public.rpc_doc_insertion_withdraw(uuid) from public, anon, service_role;
revoke all on function public._doc_insertion_in_body(doc_insertions) from public, anon, authenticated, service_role;
grant execute on function public.rpc_doc_insertion_create(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.rpc_doc_insertion_mark_applied(uuid, boolean) to authenticated;
grant execute on function public.rpc_doc_insertion_mark_removed(uuid) to authenticated;
grant execute on function public.rpc_doc_insertion_withdraw(uuid) to authenticated;

reset lock_timeout;

-- =============================================================================
-- ロールバック（表を消すと台帳も消える。本文に入った行は残る）:
--   drop function if exists public.rpc_doc_insertion_withdraw(uuid);
--   drop function if exists public.rpc_doc_insertion_mark_removed(uuid);
--   drop function if exists public.rpc_doc_insertion_mark_applied(uuid, boolean);
--   drop function if exists public._doc_insertion_in_body(doc_insertions);
--   drop function if exists public.rpc_doc_insertion_create(uuid, uuid, text, text, text);
--   drop table if exists public.doc_insertions;
-- =============================================================================
