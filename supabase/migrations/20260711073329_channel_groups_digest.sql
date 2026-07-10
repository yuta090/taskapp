-- =============================================================================
-- AI秘書 Stage 2b: グループLINE取り込み＋日次タスク抽出
-- (docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §2 — fable-architect 敵対レビュー反映済み。
--  構造は設計正本どおり。逸脱しないこと)
--
-- 追加物:
--   - channel_groups: グループトークの台帳（世代方式）
--   - channel_messages.group_id: グループ発言の帰属列（不変・guardトリガーへ追加）
--   - channel_digest_tasks: 申し送りタスク（本体tasksとは別テーブル）
--   - rpc_ingest_digest_tasks: 抽出タスクの原子INSERT＋水位更新（exactly-once）
--   - app_invoke_channel_digest / cron.schedule('channel-digest', ...)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) channel_groups — グループトークの台帳（世代方式）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- 紐付け先（店舗/顧問先）。参加直後はnull、リンクコードで確定。NULL→値の一方向のみ（トリガーで強制）
  space_id uuid,
  account_id uuid not null references public.channel_accounts(id) on delete restrict,
  channel text not null default 'line' check (channel in ('line', 'chatwork', 'slack', 'google_chat')),
  -- LINE groupId（bot退出→再招待でも同一）
  external_group_id text not null,
  display_name text,
  status text not null default 'active' check (status in ('active', 'left')),
  digest_enabled boolean not null default true,
  -- 抽出水位: このグループで最後にLLM抽出へ投入した channel_messages.created_at
  last_extracted_message_created_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete restrict
);

-- 世代方式: active な行は1グループ1件。left後の再参加・付け替えは新規行（新世代）。
-- 再招待時はこのインデックスでactive行の有無を判定する。
create unique index if not exists channel_groups_active_unique
  on public.channel_groups(account_id, external_group_id) where status = 'active';
-- 子テーブルの複合FK用（org境界の保護。Stage 1 の spaces(id, org_id) と同型）
create unique index if not exists channel_groups_id_org_unique on public.channel_groups(id, org_id);
create index if not exists channel_groups_org on public.channel_groups(org_id);

comment on table public.channel_groups is 'グループトークの台帳（世代方式）。誤紐付けの是正は unlink→再リンクで新世代を作る';
comment on column public.channel_groups.space_id is 'NULL→値の一方向のみ。旧世代の帰属は過去メッセージ・digestタスクに証跡として残る';

-- space_id は NULL→値の一方向のみ（誤紐付けの是正は unlink→再リンクで新世代を作る運用のため）
create or replace function public.channel_groups_guard_update()
returns trigger
language plpgsql
as $$
begin
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'channel_groups: space_id can only be set once (unlink + re-link for a new generation instead)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_channel_groups_guard on public.channel_groups;
create trigger trg_channel_groups_guard
  before update on public.channel_groups
  for each row execute function public.channel_groups_guard_update();

-- -----------------------------------------------------------------------------
-- 2) channel_messages への列追加（グループ発言の帰属）
-- -----------------------------------------------------------------------------
alter table public.channel_messages add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channel_messages_group_fk'
  ) then
    alter table public.channel_messages
      add constraint channel_messages_group_fk
      foreign key (group_id, org_id) references public.channel_groups(id, org_id) on delete restrict;
  end if;
end $$;

create index if not exists channel_messages_group_timeline
  on public.channel_messages(group_id, created_at desc);

comment on column public.channel_messages.group_id is
  'グループ発言の帰属（不変列）。グループ発言のspace_idは常にグループ由来のみ（identity自動帰属は適用しない）';

-- guardトリガーの immutable リストに group_id を追加（Stage 1本文からのコピー＋1行）
create or replace function public.channel_messages_guard_update()
returns trigger
language plpgsql
as $$
declare
  v_is_redaction boolean := (old.redacted_at is null and new.redacted_at is not null);
begin
  -- 不変列
  if new.org_id is distinct from old.org_id
     or new.channel is distinct from old.channel
     or new.direction is distinct from old.direction
     or new.actor is distinct from old.actor
     or new.external_user_id is distinct from old.external_user_id
     or new.external_message_id is distinct from old.external_message_id
     or new.account_id is distinct from old.account_id
     or new.sent_by is distinct from old.sent_by
     or new.occurred_at is distinct from old.occurred_at
     or new.created_at is distinct from old.created_at
     or new.group_id is distinct from old.group_id then
    raise exception 'channel_messages: immutable column cannot be changed';
  end if;

  -- 帰属は NULL→値 の一方向のみ（突合後のバックフィル用）
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'channel_messages: space_id can only be set once';
  end if;
  if old.identity_id is not null and new.identity_id is distinct from old.identity_id then
    raise exception 'channel_messages: identity_id can only be set once';
  end if;

  -- 内容(body/payload)の変更は redaction 遷移時のみ
  if (new.body is distinct from old.body or new.payload is distinct from old.payload)
     and not v_is_redaction then
    raise exception 'channel_messages: content is immutable (use rpc_redact_channel_message)';
  end if;

  -- storage_path: 添付の後追い取得(NULL→値)は許可。差し替えは禁止。除去は redaction のみ
  if new.storage_path is distinct from old.storage_path
     and not (old.storage_path is null and new.storage_path is not null)
     and not v_is_redaction then
    raise exception 'channel_messages: storage_path can only be set once (or cleared via redaction)';
  end if;

  -- redaction の取り消し・改変禁止
  if old.redacted_at is not null
     and (new.redacted_at is distinct from old.redacted_at
          or new.redacted_by is distinct from old.redacted_by
          or new.redacted_reason is distinct from old.redacted_reason) then
    raise exception 'channel_messages: redaction is irreversible';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) channel_digest_tasks — 申し送りタスク（本体tasksとは別テーブル）
-- -----------------------------------------------------------------------------
create table if not exists public.channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null,
  -- グループ紐付けからのデノーマライズ
  space_id uuid,
  source_message_id uuid not null references public.channel_messages(id) on delete restrict,
  -- LLM抽出（例:「金曜までに酒屋へ発注」）
  title text not null,
  -- LLMが読み取った担当者名（自由文字列）
  assignee_hint text,
  -- 友だち紐付け済みなら
  assignee_identity_id uuid references public.channel_identities(id),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  -- 最新digestでの表示番号（「完了N」返信の突合用）
  digest_number int,
  done_at timestamptz,
  -- 誰が消し込んだか（匿名なら null）
  done_by_external_user_id text,
  done_via text check (done_via in ('postback', 'reply', 'console')),
  -- 抽出日（JST。formatDateToLocalString使用・toISOString禁止）
  extracted_date date not null,
  created_at timestamptz not null default now(),
  -- 再抽出dedupeの二次防衛（一次は抽出水位）
  unique (source_message_id, title),
  foreign key (group_id, org_id) references public.channel_groups(id, org_id) on delete restrict,
  foreign key (space_id, org_id) references public.spaces(id, org_id) on delete restrict
);

create index if not exists channel_digest_tasks_org on public.channel_digest_tasks(org_id);
-- 「完了N」返信の突合・digest配信時の再採番で使う（openのみが対象）
create index if not exists channel_digest_tasks_group_open_number
  on public.channel_digest_tasks(group_id, digest_number) where status = 'open';

comment on table public.channel_digest_tasks is
  '申し送りタスク（作業リスト）。tasks本体とは別テーブル。将来「正式タスクに昇格」は一方向コピーのみ想定';
comment on column public.channel_digest_tasks.extracted_date is 'JST日付。toISOString()由来の値を書き込まないこと';

-- -----------------------------------------------------------------------------
-- 4) rpc_ingest_digest_tasks — 抽出タスクの原子INSERT＋水位更新（exactly-once）
-- -----------------------------------------------------------------------------
-- p_tasks: jsonb配列 [{source_message_id, title, assignee_hint}, ...]
-- 同一トランザクション内でINSERTと水位更新を行うため、
-- 「INSERT成功→水位更新前にクラッシュ」が発生しても再実行で重複タスクが出ない。
create or replace function public.rpc_ingest_digest_tasks(
  p_group_id uuid,
  p_new_watermark timestamptz,
  p_tasks jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_space_id uuid;
  v_task jsonb;
  v_rows int;
  v_inserted int := 0;
begin
  select org_id, space_id into v_org_id, v_space_id
  from channel_groups
  where id = p_group_id;

  if v_org_id is null then
    raise exception 'rpc_ingest_digest_tasks: unknown group_id %', p_group_id;
  end if;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    insert into channel_digest_tasks (
      org_id, group_id, space_id, source_message_id, title, assignee_hint, extracted_date
    )
    values (
      v_org_id,
      p_group_id,
      v_space_id,
      (v_task->>'source_message_id')::uuid,
      v_task->>'title',
      v_task->>'assignee_hint',
      (now() at time zone 'Asia/Tokyo')::date
    )
    on conflict (source_message_id, title) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  update channel_groups
  set last_extracted_message_created_at = p_new_watermark
  where id = p_group_id;

  return v_inserted;
end;
$$;

-- service role のみ実行可（LLM抽出はcron APIからservice roleで呼ぶ）
revoke execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_ingest_digest_tasks(uuid, timestamptz, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 4.5) rpc_link_group_to_space — リンクコード成立時のspace紐付け＋バックフィルの原子化
-- -----------------------------------------------------------------------------
-- 以前はアプリ側で update(channel_groups.space_id) → update(channel_messages) →
-- update(channel_digest_tasks) を別クエリで行っており、backfill前にクラッシュすると
-- 「space_idはセット済み・backfill未実行」のまま永久に固定される穴があった
-- （space_idはNULL→値の一方向のみのため再試行で直せない）。同一トランザクションにする。
create or replace function public.rpc_link_group_to_space(
  p_group_id uuid,
  p_space_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
  v_linked boolean;
begin
  update channel_groups
  set space_id = p_space_id
  where id = p_group_id
    and space_id is null;

  get diagnostics v_rows = row_count;
  v_linked := v_rows > 0;

  if v_linked then
    update channel_messages
    set space_id = p_space_id
    where group_id = p_group_id
      and space_id is null;

    update channel_digest_tasks
    set space_id = p_space_id
    where group_id = p_group_id
      and status = 'open'
      and space_id is null;
  end if;

  return v_linked;
end;
$$;

revoke execute on function public.rpc_link_group_to_space(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_link_group_to_space(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5) RLS
-- -----------------------------------------------------------------------------
alter table public.channel_groups enable row level security;
alter table public.channel_digest_tasks enable row level security;

revoke all on table public.channel_groups from anon, authenticated;
revoke all on table public.channel_digest_tasks from anon, authenticated;
grant select on table public.channel_groups to authenticated;
grant select on table public.channel_digest_tasks to authenticated;

drop policy if exists channel_groups_select_internal on public.channel_groups;
create policy channel_groups_select_internal
  on public.channel_groups
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists channel_digest_tasks_select_internal on public.channel_digest_tasks;
create policy channel_digest_tasks_select_internal
  on public.channel_digest_tasks
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- -----------------------------------------------------------------------------
-- 6) 日次digest cron（pg_cron → pg_net）
-- -----------------------------------------------------------------------------
-- cron_secret は client-reminders と共有（既にVaultへ登録済みなら再登録不要）。
-- 未設定の環境向けの手作業（1回だけ）:
--   select vault.create_secret('<CRON_SECRETの値>', 'cron_secret');
--   select vault.create_secret('https://agentpm.app/api/cron/channel-digest', 'cron_channel_digest_url');
create or replace function public.app_invoke_channel_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'cron_channel_digest_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'channel digest: vault secrets (cron_channel_digest_url / cron_secret) が未設定です';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_channel_digest() from public;
revoke all on function public.app_invoke_channel_digest() from anon;
revoke all on function public.app_invoke_channel_digest() from authenticated;

-- スケジュール登録: 22:00 UTC = 翌朝7:00 JST（pg_cronがある環境のみ）
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'channel-digest') then
      perform cron.schedule('channel-digest', '0 22 * * *', 'select app_invoke_channel_digest()');
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後にservice roleで実施。docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §8参照）:
--   1) disabledアカウント: inboundは記録され続け、自動応答・digest・送信APIのみ停止
--   2) join→挨拶→リンクコードでspace紐付け→以降の発言にspace_idが付く。backfillも実施される
--   3) 誤space紐付け→unlink→再リンクで新世代。旧世代のopenタスクがauto-dismiss
--   4) 1対1 identityを持つ人のグループ発言にidentity由来のspace_idが付かない
--   5) 匿名メンバー発言（userIdなし）が記録され抽出対象になる
--   6) 朝digest: open のみ・0件なら送らない・postback/「完了N」で消える・番号クリアの確認
--   7) postback二重タップの2回目が「既に完了済みです」
--   8) 他グループ/他orgのpostback・他org内部ユーザーのgroups/digest-tasks/accounts PATCHが拒否
--   9) 抽出のexactly-once（同一トランザクション）
--   10) org_ai_config未設定orgでdigest cronがエラーにならずスキップされる
--   11) roomに招待されたら案内を送って退出する
-- ロールバック:
--   select cron.unschedule('channel-digest');
--   drop function app_invoke_channel_digest, rpc_ingest_digest_tasks(uuid, timestamptz, jsonb),
--     rpc_link_group_to_space(uuid, uuid);
--   drop table channel_digest_tasks;
--   alter table channel_messages drop constraint channel_messages_group_fk, drop column group_id;
--   drop table channel_groups cascade;
--   drop function channel_groups_guard_update;
--   （channel_messages_guard_update は Stage 1版に戻すなら20260710204722のcreate or replaceを再適用）
-- =============================================================================
