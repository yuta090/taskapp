-- =============================================================================
-- Stage 2.7-A: 内部ユーザーの LINE 本人紐付け
-- 仕様: docs/spec/AI_SECRETARY_STAGE2_7_APPROVAL.md §3
--
-- なぜ新テーブルか:
--   既存 channel_identities は space_id 必須の「顧問先の窓口」identity であり、
--   profiles/auth.users への FK を持たない（AI_SECRETARY_STAGE2_6_DUE_ASSIGNEE.md:203-204）。
--   そこに社内メンバーを混ぜると「グループ発言の space は identity から導出しない」という
--   不変条件（webhookHandler.ts:416）に穴が開く。よって別テーブルで分離する。
--
--   既存 channel_link_codes は *意図的にワンタイムでない*（30日マルチユース。
--   「紙/QRを社長と経理の2人が読む運用」20260710204722:111-112）。
--   同じコードを読んだ別人の承認が本人の承認として通ってしまうため、本人性には流用できない。
--
-- 承認の本人性はこの紐付けだけでは担保しない:
--   紐付けは「キャッシュ」に過ぎない。承認のたびに org/space の在籍を再検証する（§3-5）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 複合FKの受け皿
--
-- org_id / channel_account_id を独立したFKにすると「org Aのコードだがそのメッセージは
-- org B のOA宛て」というクロステナント行を作れてしまう（service_role は RLS を迂回するため、
-- アプリ側の認可漏れが1回あると永続的な越境リンクになる）。複合FKでDBに強制させる。
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_accounts_id_org_uniq'
  ) then
    alter table public.channel_accounts
      add constraint channel_accounts_id_org_uniq unique (id, org_id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1) 紐付け本体
-- -----------------------------------------------------------------------------
create table if not exists public.channel_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'line' check (channel in ('line')),
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  external_user_id text not null,
  linked_via text not null default 'code' check (linked_via in ('code', 'line_login')),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id),
  -- OA の所属org と リンクの org_id が食い違う行を作れないようにする
  constraint channel_user_links_account_org_fk
    foreign key (channel_account_id, org_id)
    references public.channel_accounts(id, org_id) on delete cascade
);

-- active = revoked_at is null。status 列は持たない（status と revoked_at の矛盾状態を作らない）
-- 同じLINEアカウントを複数の内部ユーザーへ結ぶことを禁止する（なりすまし防止の要）
create unique index if not exists channel_user_links_active_external
  on public.channel_user_links(org_id, channel_account_id, external_user_id)
  where revoked_at is null;

-- 1人の内部ユーザーが同一OAで複数のLINEを active にすることも禁止する
create unique index if not exists channel_user_links_active_user
  on public.channel_user_links(org_id, channel_account_id, user_id)
  where revoked_at is null;

comment on table public.channel_user_links is
  '内部ユーザー(auth.users) と LINE userId の本人紐付け。channel_identities（顧問先の窓口）とは別軸。承認の本人性の土台だが、これ単体は認可の十分条件ではない（承認時に在籍を再検証する）';

-- -----------------------------------------------------------------------------
-- 2) ワンタイム紐付けコード（平文は保存しない）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_user_link_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint channel_user_link_codes_account_org_fk
    foreign key (channel_account_id, org_id)
    references public.channel_accounts(id, org_id) on delete cascade
);

create unique index if not exists channel_user_link_codes_hash
  on public.channel_user_link_codes(code_hash) where used_at is null;

comment on column public.channel_user_link_codes.code_hash is
  'sha256(コード平文)。平文はDBに保存しない（発行APIのレスポンスで一度だけ返す）。会話ログ(channel_messages)にも保存前にマスクする（append-onlyのため入れたら消せない）';

-- -----------------------------------------------------------------------------
-- 3) 試行履歴（総当たり対策）
--
-- コード行の attempt_count では「外部userIdごとの10分窓」を表現できないため、
-- 履歴テーブルで持つ。ロック中は行を増やさない（増やすと窓が延長され永久ロックになる）。
-- -----------------------------------------------------------------------------
create table if not exists public.channel_user_link_attempts (
  id uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  external_user_id text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists channel_user_link_attempts_window
  on public.channel_user_link_attempts(channel_account_id, external_user_id, attempted_at desc);

-- -----------------------------------------------------------------------------
-- 4) 権限: service_role のみ（既存 channel_plumbing と同じ流儀）
--    RLS だけでなく明示的な REVOKE も行う。attempts は LINE userId を持つため同格に扱う。
-- -----------------------------------------------------------------------------
alter table public.channel_user_links        enable row level security;
alter table public.channel_user_link_codes   enable row level security;
alter table public.channel_user_link_attempts enable row level security;
-- ポリシーは作らない = anon/authenticated からは一切見えない（service_role のみ）

revoke all on public.channel_user_links        from anon, authenticated;
revoke all on public.channel_user_link_codes   from anon, authenticated;
revoke all on public.channel_user_link_attempts from anon, authenticated;

grant all on public.channel_user_links        to service_role;
grant all on public.channel_user_link_codes   to service_role;
grant all on public.channel_user_link_attempts to service_role;

-- -----------------------------------------------------------------------------
-- 5) コード消費 RPC
--
-- 契約（重要）:
--   *例外を投げない*。失敗も戻り値で返す。
--   理由: 例外を送出すると同一トランザクション内の試行履歴 INSERT もロールバックされ、
--   総当たり対策が機能しなくなる（失敗が記録されないので何度でも試せる）。
--
-- status: 'ok' | 'invalid' | 'expired' | 'locked' | 'conflict'
-- -----------------------------------------------------------------------------
create or replace function public.rpc_consume_user_link_code(
  p_code_hash text,
  p_channel_account_id uuid,
  p_external_user_id text
)
returns table (status text, link_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fail_count int;
  v_code       public.channel_user_link_codes%rowtype;
  v_consumed   uuid;
  v_link       uuid;
  v_conflict   boolean := false;
  v_result     text;
begin
  -- 直列化。これが無いと同時リクエストが全員「5回未満」を観測してロックを突破する
  perform pg_advisory_xact_lock(
    hashtext(p_channel_account_id::text || ':' || p_external_user_id)
  );

  -- 試行制限: 直近10分の失敗が5回以上ならロック。
  -- ここでは試行行を *追加しない*（追加すると窓が延長され、永久にロックが解けない）。
  -- 結果としてロックは「5回目の失敗から10分後」に自然解除される。
  select count(*) into v_fail_count
  from public.channel_user_link_attempts
  where channel_account_id = p_channel_account_id
    and external_user_id = p_external_user_id
    and not succeeded
    and attempted_at > now() - interval '10 minutes';

  if v_fail_count >= 5 then
    return query select 'locked'::text, null::uuid;
    return;
  end if;

  -- コードの状態を先に読み、invalid と expired を区別する
  select * into v_code
  from public.channel_user_link_codes
  where code_hash = p_code_hash
  limit 1;

  if not found
     or v_code.used_at is not null
     -- 他OA・他orgのコードは成立させない（束縛検証）
     or v_code.channel_account_id <> p_channel_account_id
  then
    insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
    values (p_channel_account_id, p_external_user_id, false);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_code.expires_at <= now() then
    insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
    values (p_channel_account_id, p_external_user_id, false);
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  -- 消費とリンク作成を1つのセーブポイント（暗黙）に閉じ込める。
  -- 一意制約違反（そのLINEが既に別ユーザーに紐付いている）ならブロックごと巻き戻り、
  -- *コードの消費も取り消される*（正当な本人があとで使えるようコードを無駄にしない）。
  begin
    update public.channel_user_link_codes
       set used_at = now()
     where id = v_code.id
       and used_at is null
       and expires_at > now()
    returning id into v_consumed;

    if v_consumed is not null then
      insert into public.channel_user_links
        (org_id, user_id, channel, channel_account_id, external_user_id, linked_via)
      values
        (v_code.org_id, v_code.user_id, 'line', p_channel_account_id, p_external_user_id, 'code')
      returning id into v_link;
    end if;
  exception
    when unique_violation then
      -- DBの変更は巻き戻るが、plpgsql の変数は巻き戻らないので明示的に戻す
      v_conflict := true;
      v_consumed := null;
      v_link := null;
  end;

  if v_conflict then
    v_result := 'conflict';
  elsif v_consumed is null then
    -- CAS で0行 = 同時実行に負けた（誰かが先に消費した）
    v_result := 'invalid';
  else
    v_result := 'ok';
  end if;

  -- 試行履歴はセーブポイントの外なので、conflict でも残る
  insert into public.channel_user_link_attempts (channel_account_id, external_user_id, succeeded)
  values (p_channel_account_id, p_external_user_id, v_result = 'ok');

  return query select v_result, v_link;
end $$;

revoke all on function public.rpc_consume_user_link_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_consume_user_link_code(text, uuid, text) to service_role;

comment on function public.rpc_consume_user_link_code(text, uuid, text) is
  'ワンタイム紐付けコードを消費して channel_user_links を作る。例外を投げず status で返す（例外だと試行履歴がロールバックされ総当たり対策が壊れる）。status: ok|invalid|expired|locked|conflict';

-- -----------------------------------------------------------------------------
-- 6) 失効 RPC（本人 or org admin がコンソールから）
-- -----------------------------------------------------------------------------
create or replace function public.rpc_revoke_user_link(
  p_link_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  update public.channel_user_links
     set revoked_at = now(),
         revoked_by = p_actor_user_id
   where id = p_link_id
     and revoked_at is null
  returning id into v_updated;

  return v_updated is not null;  -- 二重失効は false（副作用ゼロ）
end $$;

revoke all on function public.rpc_revoke_user_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_revoke_user_link(uuid, uuid) to service_role;
