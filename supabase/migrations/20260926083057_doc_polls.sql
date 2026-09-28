-- =============================================================================
-- 投票ブロック PR1（DB 部分）: 投票・票・票の履歴
-- 確定設計: docs/spec/DOC_VOTE_SPEC.md §4（Fable 裁定 2026-09-26）
-- 依存: 20260911143112_space_role_boundary.sql（app_is_space_internal / app_can_write_space）,
--       20260911155718_space_org_fk.sql（spaces の (id, org_id) の一意性）,
--       20260907142526_mfa_rls_enforcement.sql（mfa_satisfied）を先に適用。
--
-- 目的: Wiki・議事録の本文に置く「投票」ブロックの票を、本文とは別の表に持つ。
--   本文に票を書くと、押すたびに本文の保存が走り、Wiki の楽観ロック・議事録の書記の保存とぶつかる。
--   本文には投票の番号（Wiki は block props の pollId、議事録は `<!--vote:uuid-->` 行）だけを書く。
--
--   doc_polls        投票1つ。どの文書のものか・理由必須か。作ったあとは変えない
--   doc_votes        今の票（1人1行）。OK / NG / 保留 と、改行を含むメモ
--   doc_vote_events  票の履歴（追記だけ）。押した・選び直した・取り消した
--   rpc_doc_poll_create  投票を作る（社内の編集者だけ）
--   rpc_doc_vote_cast    押す・選び直す・取り消す（読める人なら誰でも）。1人1票・理由必須・履歴をここで守る
--   app_can_read_doc_poll  その投票を読めるか（3表の読み取りポリシーと rpc_doc_vote_cast が使う）
--
-- 読める人・押せる人（PR1）: 社内（app_is_space_internal。読むだけの viewer を含む）。
--   相手先（space の role が client / vendor）は PR3 で app_can_read_doc_poll に足す。判定はこの関数1か所に寄せる。
-- 作れる人: その文書の space に書ける社内メンバー（app_can_write_space）。
-- 書き込み: 3表とも authenticated に insert / update / delete を与えない。入口の関数（security definer）だけが書く。
--   関数は RLS を通らないので、二要素認証（mfa_satisfied）も関数の中で確かめる。
-- 3表とも、既存の全 RLS 表と同じ二要素認証の RESTRICTIVE ポリシー mfa_required_when_enrolled を付ける。
--
-- エラーの返し方（画面が見分ける）:
--   42501 forbidden         読めない・書けない・存在しない（有無を見分けさせないため同じ返事）
--   22023 reason_required   理由必須の投票で、NG・保留のメモが空
--   22023 その他            引数の形が違う（invalid_choice / memo_too_long / poll_id_in_use など）
--
-- 範囲: 新しい表3つ・関数4つ・ポリシー・トリガー・索引のみ。既存の表・列・ポリシー・関数・データは変更しない。
-- 冪等: create table / index if not exists、drop policy if exists → create policy、create or replace function、
--   drop trigger if exists → create trigger。再実行安全。
-- 破壊的変更: なし。可逆: 末尾のロールバック節（表を消すと票と履歴も消える）。
-- =============================================================================

-- 参照先（wiki_pages / meetings / spaces）に外部キーを張るときの短いロックを、長く待たない
set lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- 1) doc_polls: 投票1つ
-- -----------------------------------------------------------------------------
create table if not exists public.doc_polls (
  -- 番号は画面が作って本文に書き込む（押す前に本文へ置けるように）。作るときに文書との組を確かめる
  id              uuid primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  space_id        uuid not null,
  -- どちらか片方だけ（多相キーにすると外部キーが張れず、文書を消しても投票が残る）
  wiki_page_id    uuid null references public.wiki_pages(id) on delete cascade,
  meeting_id      uuid null references public.meetings(id) on delete cascade,
  -- none = 理由は任意 / ng_hold = NG と保留は理由必須（/votemust で作ったもの）
  reason_required text not null check (reason_required in ('none', 'ng_hold')),
  created_by      uuid null references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint doc_polls_one_document check ((wiki_page_id is null) <> (meeting_id is null)),
  constraint doc_polls_space_org_fkey foreign key (space_id, org_id)
    references public.spaces (id, org_id) on delete cascade
);

create index if not exists doc_polls_wiki_page_idx on public.doc_polls (wiki_page_id) where wiki_page_id is not null;
create index if not exists doc_polls_meeting_idx on public.doc_polls (meeting_id) where meeting_id is not null;

comment on table public.doc_polls is
  'Wiki・議事録の投票ブロック1つ。本文には id だけを書く。作ったあとは変えない（DOC_VOTE_SPEC §4）';
comment on column public.doc_polls.reason_required is
  'none = 理由は任意 / ng_hold = NG と保留は理由必須。作成時に決め、以後変えない';

-- 作ったあとは変えない。関数も更新しないが、service role や手作業でも変えられないよう止めておく。
-- 例外は1つだけ: 作った人のアカウントを消したとき、外部キーの on delete set null が created_by を
-- 空にする更新。これまで止めると、投票を1つでも作った人を削除できなくなる。
create or replace function public.doc_polls_immutable()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if old.created_by is not null
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  raise exception 'doc_polls is immutable' using errcode = '22023';
end;
$$;

comment on function public.doc_polls_immutable() is
  'doc_polls の更新を拒否するトリガー（理由必須の設定・文書との組は作ったあと変えない）。作成者の削除で created_by が空になる更新だけ通す';

revoke all on function public.doc_polls_immutable() from public, anon, authenticated;

drop trigger if exists doc_polls_no_update on public.doc_polls;
create trigger doc_polls_no_update
  before update on public.doc_polls
  for each row execute function public.doc_polls_immutable();

-- -----------------------------------------------------------------------------
-- 2) doc_votes: 今の票（1人1行）
-- -----------------------------------------------------------------------------
create table if not exists public.doc_votes (
  poll_id    uuid not null references public.doc_polls(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  choice     text not null check (choice in ('ok', 'ng', 'hold')),
  memo       text not null default '' check (char_length(memo) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

comment on table public.doc_votes is
  '投票ブロックの今の票（1人1行）。書くのは rpc_doc_vote_cast だけ';

-- -----------------------------------------------------------------------------
-- 3) doc_vote_events: 票の履歴（追記だけ）
-- -----------------------------------------------------------------------------
create table if not exists public.doc_vote_events (
  id         bigint generated always as identity primary key,
  poll_id    uuid not null references public.doc_polls(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- cast = 初めて押した / change = 選び直した・メモを直した / retract = 取り消した
  action     text not null check (action in ('cast', 'change', 'retract')),
  choice     text null check (choice in ('ok', 'ng', 'hold')),
  memo       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists doc_vote_events_poll_idx on public.doc_vote_events (poll_id, id);

comment on table public.doc_vote_events is
  '投票ブロックの票の履歴（追記だけ。誰も書き換え・削除できない）。書くのは rpc_doc_vote_cast だけ';

-- -----------------------------------------------------------------------------
-- 4) 読めるか: app_can_read_doc_poll
-- -----------------------------------------------------------------------------
-- 3表の読み取りポリシーと rpc_doc_vote_cast の両方がここを見る（読める人＝押せる人）。
-- 相手先を足すとき（PR3）はこの関数だけを変える。
create or replace function public.app_can_read_doc_poll(p_poll uuid)
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
      and public.app_is_space_internal(p.space_id, p.org_id)
  );
$$;

comment on function public.app_can_read_doc_poll(uuid) is
  'RLS補助: その投票を読めるか（＝押せるか）。PR1 は社内（app_is_space_internal）だけ。doc_polls は RLS を通らずに読む';

revoke all on function public.app_can_read_doc_poll(uuid) from public, anon;
grant execute on function public.app_can_read_doc_poll(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) 権限とポリシー
-- -----------------------------------------------------------------------------
alter table public.doc_polls enable row level security;
alter table public.doc_votes enable row level security;
alter table public.doc_vote_events enable row level security;

revoke all on table public.doc_polls, public.doc_votes, public.doc_vote_events from public, anon, authenticated;
grant select on table public.doc_polls, public.doc_votes, public.doc_vote_events to authenticated;

drop policy if exists doc_polls_select on public.doc_polls;
create policy doc_polls_select on public.doc_polls
  for select to authenticated
  using (public.app_can_read_doc_poll(id));

drop policy if exists doc_votes_select on public.doc_votes;
create policy doc_votes_select on public.doc_votes
  for select to authenticated
  using (public.app_can_read_doc_poll(poll_id));

drop policy if exists doc_vote_events_select on public.doc_vote_events;
create policy doc_vote_events_select on public.doc_vote_events
  for select to authenticated
  using (public.app_can_read_doc_poll(poll_id));

-- 二要素認証（既存の全 RLS 表と同じ名前・同じ式）
do $$
declare
  v_table text;
begin
  foreach v_table in array array['doc_polls', 'doc_votes', 'doc_vote_events'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table and policyname = 'mfa_required_when_enrolled'
    ) then
      execute format(
        'create policy mfa_required_when_enrolled on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
        v_table
      );
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6) 作る: rpc_doc_poll_create
-- -----------------------------------------------------------------------------
-- 番号は画面が作る。通信の再送で同じ番号・同じ文書が来たら、そのまま同じ番号を返す（二重にしない）。
-- 同じ番号が別の文書で使われていたら拒否する（コピーした番号を別の文書で横取りさせない）。
create or replace function public.rpc_doc_poll_create(
  p_poll_id uuid,
  p_wiki_page_id uuid,
  p_meeting_id uuid,
  p_reason_required text
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_space uuid;
  v_org   uuid;
  r       doc_polls%rowtype;
begin
  if p_poll_id is null then
    raise exception 'poll_id_required' using errcode = '22023';
  end if;
  if (p_wiki_page_id is null) = (p_meeting_id is null) then
    raise exception 'exactly_one_document' using errcode = '22023';
  end if;
  if p_reason_required is null or p_reason_required not in ('none', 'ng_hold') then
    raise exception 'invalid_reason_required' using errcode = '22023';
  end if;

  -- space / org は文書から取る（引数で受けない）
  if p_wiki_page_id is not null then
    select w.space_id, w.org_id into v_space, v_org from wiki_pages w where w.id = p_wiki_page_id;
  else
    select m.space_id, m.org_id into v_space, v_org from meetings m where m.id = p_meeting_id;
  end if;

  -- 文書が無い場合と書けない場合は同じ返事にする
  if v_space is null
     or auth.uid() is null
     or not public.app_can_write_space(v_space, v_org)
     or not public.mfa_satisfied() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into doc_polls (id, org_id, space_id, wiki_page_id, meeting_id, reason_required, created_by)
  values (p_poll_id, v_org, v_space, p_wiki_page_id, p_meeting_id, p_reason_required, auth.uid())
  on conflict (id) do nothing;

  select * into r from doc_polls where id = p_poll_id;
  if r.wiki_page_id is distinct from p_wiki_page_id or r.meeting_id is distinct from p_meeting_id then
    raise exception 'poll_id_in_use' using errcode = '22023';
  end if;

  return p_poll_id;
end;
$$;

comment on function public.rpc_doc_poll_create(uuid, uuid, uuid, text) is
  '投票ブロックを作る。呼べるのは文書の space に書ける社内メンバー（app_can_write_space）で二要素認証の条件を満たす人。同じ番号・同じ文書の再送はそのまま返す';

revoke all on function public.rpc_doc_poll_create(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.rpc_doc_poll_create(uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) 押す・選び直す・取り消す: rpc_doc_vote_cast
-- -----------------------------------------------------------------------------
-- p_choice が null なら取り消し。同じ内容で押し直したときは何も書かない（履歴を増やさない）。
-- 今の票と履歴は同じ取引で書く（片方だけ残らない）。
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
declare
  v_uid  uuid := auth.uid();
  v_memo text := coalesce(p_memo, '');
  v_poll doc_polls%rowtype;
  v_old  doc_votes%rowtype;
begin
  select * into v_poll from doc_polls where id = p_poll_id;
  if not found
     or v_uid is null
     or not public.app_can_read_doc_poll(p_poll_id)
     or not public.mfa_satisfied() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 同じ人が同じ投票へほぼ同時に送ったとき、1本ずつ順に処理する（取引が終わるまで待たせる）。
  -- 待たせないと、どちらも「まだ票が無い」と見て insert し、2本目が重複で落ちる
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

comment on function public.rpc_doc_vote_cast(uuid, text, text) is
  '投票ブロックで押す（ok / ng / hold）・選び直す・取り消す（p_choice = null）。読める人（app_can_read_doc_poll）なら押せる。1人1票・理由必須・履歴の追記をここで守る';

revoke all on function public.rpc_doc_vote_cast(uuid, text, text) from public, anon;
grant execute on function public.rpc_doc_vote_cast(uuid, text, text) to authenticated;

reset lock_timeout;

-- =============================================================================
-- 適用後の確認（本番で読むだけ）:
--   select tablename, policyname, permissive, cmd from pg_policies
--    where tablename in ('doc_polls', 'doc_votes', 'doc_vote_events') order by 1, 2;
--   → 各表に *_select（PERMISSIVE / SELECT）と mfa_required_when_enrolled（RESTRICTIVE / ALL）
--   select has_function_privilege('anon', 'public.rpc_doc_vote_cast(uuid, text, text)', 'execute');  → false
--   select has_table_privilege('authenticated', 'public.doc_votes', 'insert');                       → false
--
-- ロールバック（表を消すと票と履歴も消える。不可逆）:
--   drop function if exists public.rpc_doc_vote_cast(uuid, text, text);
--   drop function if exists public.rpc_doc_poll_create(uuid, uuid, uuid, text);
--   drop table if exists public.doc_vote_events;
--   drop table if exists public.doc_votes;
--   drop table if exists public.doc_polls;
--   drop function if exists public.app_can_read_doc_poll(uuid);
--   drop function if exists public.doc_polls_immutable();
-- =============================================================================
