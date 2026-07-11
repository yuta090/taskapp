-- =============================================================================
-- AI秘書 Stage 3 PR-1: 外部連携シンク基盤
-- (docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §1・§2・§7 — fable-architect
--  敵対的レビュー反映済み v0.2。構造は設計正本どおり。逸脱しないこと)
--
-- 追加物:
--   - integration_sinks / sink_deliveries / sink_external_refs
--   - channel_digest_tasks への enqueue トリガー（AFTER INSERT/UPDATE）
--   - rpc_claim_sink_deliveries / rpc_complete_sink_delivery /
--     rpc_reactivate_sink / rpc_redeliver_sink_delivery / rpc_redeliver_sink
--   - rpc_redact_channel_message の拡張（digestタスクtitle破壊＋dismiss連動配達）
--   - integration_connections.provider に notion / google_sheets を追加
--   - app_invoke_sink_dispatch / cron.schedule('sink-dispatch', ...)
--
-- 設計からの逸脱（判断根拠は各節のコメント参照）:
--   1) sink_deliveries.sink_id は設計書§1-2の記載(on delete cascade)ではなく
--      on delete restrict にし、integration_sinks の物理DELETEを禁止するガードを追加した。
--      cascadeのままだとsink削除で配達ログも消え、受け入れ基準11
--      「sink削除後も配達ログが参照できる」と設計書§3 DELETE欄の
--      「削除（deliveriesはログとして残す）」に矛盾するため。
--      API層のDELETEはstatus='disabled'への更新として実装する
--      （channel_identitiesのDELETE禁止＋revokeのみパターンを踏襲）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) integration_connections: provider に notion / google_sheets を追加
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in ('google_calendar', 'zoom', 'google_meet', 'teams', 'notion', 'google_sheets'));

-- -----------------------------------------------------------------------------
-- 1) integration_sinks — 配達先の台帳
-- -----------------------------------------------------------------------------
create table if not exists public.integration_sinks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- 配達元のスコープ: org全体 or 特定グループ。NULL = org全体
  group_id uuid,
  provider text not null check (provider in ('webhook', 'notion', 'google_sheets')),
  display_name text not null,
  -- provider別設定（webhook: url / notion: database_id / sheets: spreadsheet_id, sheet_name）
  config jsonb not null default '{}',
  -- webhook: HMAC secret（暗号化）。OAuth系は integration_connections を参照
  secret_encrypted text,
  connection_id uuid references public.integration_connections(id) on delete set null,
  -- 購読イベント（タイポ＝無音無配達を型で防ぐ）
  events text[] not null default '{task.created,task.done,task.dismissed}',
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  consecutive_failures int not null default 0,
  last_delivered_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- org境界保護（Stage 2 と同じ複合FKパターン。group_id が NULL の行は評価対象外＝org全体スコープ）
  foreign key (group_id, org_id) references public.channel_groups(id, org_id),
  -- secret と connection の同居事故を型で防ぐ
  check (
    (provider = 'webhook' and connection_id is null and secret_encrypted is not null)
    or (provider <> 'webhook' and secret_encrypted is null)
  ),
  check (events <@ array['task.created','task.done','task.dismissed','task.reopened']::text[])
);

create index if not exists integration_sinks_org on public.integration_sinks(org_id);
create index if not exists integration_sinks_group on public.integration_sinks(group_id) where group_id is not null;
-- enqueueトリガーのsink解決(org_id×status='active')で使う
create index if not exists integration_sinks_dispatch_lookup
  on public.integration_sinks(org_id, status) where status = 'active';

comment on table public.integration_sinks is '配達先（Webhook/Notion/Google Sheets）の台帳。secret_encryptedはauthenticatedから不可視（列レベルgrantで制御）';
comment on column public.integration_sinks.group_id is 'NULL=org全体スコープ。値ありなら当該グループのdigestタスクのみ配達対象';

-- DELETE禁止: 消すとsink_deliveries(配達ログ=証跡)の帰属が壊れる。API層はstatus='disabled'で「削除」を表現する
-- （channel_identities_no_delete と同型パターン）。
create or replace function public.integration_sinks_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'integration_sinks: DELETE is forbidden. Set status=disabled instead (deliveries must remain as an audit trail).';
end;
$$;

drop trigger if exists trg_integration_sinks_no_delete on public.integration_sinks;
create trigger trg_integration_sinks_no_delete
  before delete on public.integration_sinks
  for each row execute function public.integration_sinks_no_delete();

create or replace function public.integration_sinks_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_integration_sinks_touch_updated_at on public.integration_sinks;
create trigger trg_integration_sinks_touch_updated_at
  before update on public.integration_sinks
  for each row execute function public.integration_sinks_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2) sink_deliveries — 配達ログ兼アウトボックス
-- -----------------------------------------------------------------------------
create table if not exists public.sink_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- on delete restrict: 上記の逸脱コメント参照（cascadeにしない＝証跡保護）
  sink_id uuid not null references public.integration_sinks(id) on delete restrict,
  -- タスク単位の履歴・external_refs突合用（pingはNULL）
  digest_task_id uuid,
  -- 'task.created' | 'task.done' | 'task.dismissed' | 'task.reopened' | 'ping'
  event_type text not null check (
    event_type in ('task.created', 'task.done', 'task.dismissed', 'task.reopened', 'ping')
  ),
  -- 冪等キー: 状態遷移1回ごとに一意（トリガー内で生成する遷移イベントUUIDを共有）
  event_key text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- 先頭数百byteに切り詰めて保存（レスポンスbodyは保存しない）
  last_error text,
  response_status int,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (sink_id, event_key)
);

create index if not exists sink_deliveries_org on public.sink_deliveries(org_id);
create index if not exists sink_deliveries_sink_created on public.sink_deliveries(sink_id, created_at desc);
create index if not exists sink_deliveries_task on public.sink_deliveries(digest_task_id) where digest_task_id is not null;
-- dispatcher用の部分インデックス
create index if not exists sink_deliveries_dispatch_idx
  on public.sink_deliveries (next_attempt_at) where status in ('queued', 'failed');

comment on table public.sink_deliveries is '配達ログ兼アウトボックス。削除しない（証跡）。再送はstatus更新のみで行い、行自体は保持する';
comment on column public.sink_deliveries.event_key is '状態遷移1回ごとに一意。<event_type>:<task_id>:<遷移event_uuid> 形式（トリガーが生成）';

-- -----------------------------------------------------------------------------
-- 3) sink_external_refs — 外部オブジェクト対応表（Notion用。PR-1では書込者なしだが表は先行作成）
-- -----------------------------------------------------------------------------
create table if not exists public.sink_external_refs (
  sink_id uuid not null references public.integration_sinks(id) on delete cascade,
  digest_task_id uuid not null,
  external_ref text not null,
  created_at timestamptz not null default now(),
  primary key (sink_id, digest_task_id)
);

comment on table public.sink_external_refs is 'Notion等の外部オブジェクト対応表。deliveriesがdead化・再送されても対応関係が壊れないようdeliveriesとは独立に保持する';

-- -----------------------------------------------------------------------------
-- 4) enqueue トリガー — channel_digest_tasks への AFTER INSERT / AFTER UPDATE
-- -----------------------------------------------------------------------------
-- INSERT → task.created。UPDATEは old.status IS DISTINCT FROM new.status の時のみ発火。
-- 遷移イベントUUIDをトリガー内で1つ生成し、対象sink全行のevent_keyに共有する
-- （done→reopen→再done の3遷移がすべて配達される。§2-1参照）。
-- digest抽出(rpc_ingest_digest_tasks)と同一トランザクションで動くため、
-- 抽出Txがロールバックされればenqueueも消える（受け入れ基準1）。
create or replace function public.channel_digest_tasks_enqueue_sink_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_event_uuid uuid;
  v_group_name text;
  v_group_channel text;
  v_space_name text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'task.created';
  elsif tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then
      return new;
    end if;
    v_event_type := case new.status
      when 'done' then 'task.done'
      when 'dismissed' then 'task.dismissed'
      when 'open' then 'task.reopened'
      else null
    end;
    if v_event_type is null then
      return new;
    end if;
  else
    return new;
  end if;

  v_event_uuid := gen_random_uuid();

  select display_name, channel into v_group_name, v_group_channel
  from channel_groups where id = new.group_id;

  if new.space_id is not null then
    select name into v_space_name from spaces where id = new.space_id;
  end if;

  -- ペイロードは常にフルスナップショット＋occurred_at必須（§2-4）。
  -- 元のチャット本文・添付・identity実名は配達しない（title/assignee_hint/statusまで）。
  insert into sink_deliveries (org_id, sink_id, digest_task_id, event_type, event_key, payload)
  select
    new.org_id,
    s.id,
    new.id,
    v_event_type,
    v_event_type || ':' || new.id::text || ':' || v_event_uuid::text,
    jsonb_build_object(
      'occurred_at', now(),
      'task', jsonb_build_object(
        'id', new.id,
        'title', new.title,
        'assignee_hint', new.assignee_hint,
        'status', new.status,
        'group', v_group_name,
        'space', v_space_name,
        'source', jsonb_build_object('channel', v_group_channel)
      )
    )
  from integration_sinks s
  where s.org_id = new.org_id
    and (s.group_id is null or s.group_id = new.group_id)
    and s.status = 'active'
    and v_event_type = any(s.events);

  return new;
end;
$$;

drop trigger if exists trg_channel_digest_tasks_enqueue_sink_deliveries on public.channel_digest_tasks;
create trigger trg_channel_digest_tasks_enqueue_sink_deliveries
  after insert or update on public.channel_digest_tasks
  for each row execute function public.channel_digest_tasks_enqueue_sink_deliveries();

-- -----------------------------------------------------------------------------
-- 5) rpc_claim_sink_deliveries — dispatcher用のリース取得（for update skip locked）
-- -----------------------------------------------------------------------------
-- 選定: next_attempt_at <= now() AND status in ('queued','failed') AND sink.status='active'
-- を古い順、for update skip locked で多重起動に安全。全体上限＋sinkあたり上限で
-- 壊れた1sinkのリトライがバッチを占有しないようにする。
-- 取得した行はリース期間(2分)だけnext_attempt_atを未来に押し出し、
-- 呼び出し側(app)がHTTP配送後にrpc_complete_sink_deliveryで確定させる。
create or replace function public.rpc_claim_sink_deliveries(
  p_total_limit int default 100,
  p_per_sink_limit int default 10
)
returns setof public.sink_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease_until timestamptz := now() + interval '2 minutes';
begin
  return query
  with candidates as (
    select d.id, d.sink_id, d.next_attempt_at
    from sink_deliveries d
    join integration_sinks s on s.id = d.sink_id
    where d.status in ('queued', 'failed')
      and d.next_attempt_at <= now()
      and s.status = 'active'
    order by d.next_attempt_at asc
    limit greatest(p_total_limit * 10, 1000)
    for update of d skip locked
  ),
  ranked as (
    select c.id, c.next_attempt_at,
           row_number() over (partition by c.sink_id order by c.next_attempt_at asc) as rn
    from candidates c
  ),
  chosen as (
    select id from ranked
    where rn <= p_per_sink_limit
    order by next_attempt_at asc
    limit p_total_limit
  )
  update sink_deliveries d
  set next_attempt_at = v_lease_until
  from chosen
  where d.id = chosen.id
  returning d.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) rpc_complete_sink_delivery — 配送結果の確定（バックオフ計算・sink自動停止込み）
-- -----------------------------------------------------------------------------
-- p_outcome: 'sent' | 'temporary_fail' | 'permanent_fail'
-- バックオフ表(1分→5分→30分→2時間→6時間、5回リトライ後にdead=最大6試行)は
-- src/lib/sinks/backoff.ts の BACKOFF_MINUTES / MAX_DELIVERY_ATTEMPTS と値を合わせること。
-- p_counts_toward_failures: 400/404/422はfalse（毒deliveryがconsecutive_failuresを
-- 押し上げるのを防ぐ）。401/403・一時失敗はtrue。
create or replace function public.rpc_complete_sink_delivery(
  p_delivery_id uuid,
  p_outcome text,
  p_response_status int,
  p_error text,
  p_counts_toward_failures boolean
)
returns table (
  delivery_status text,
  sink_status text,
  consecutive_failures int,
  just_became_error boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sink_id uuid;
  v_attempts int;
  v_new_status text;
  v_backoff_minutes int[] := array[1, 5, 30, 120, 360];
  v_delay_minutes int;
  v_sink_status text;
  v_consecutive_failures int;
  v_prev_sink_status text;
  v_just_became_error boolean := false;
begin
  select sink_id, attempts into v_sink_id, v_attempts
  from sink_deliveries where id = p_delivery_id
  for update;

  if v_sink_id is null then
    raise exception 'rpc_complete_sink_delivery: unknown delivery_id %', p_delivery_id;
  end if;

  if p_outcome = 'sent' then
    update sink_deliveries
    set status = 'sent',
        delivered_at = now(),
        attempts = attempts + 1,
        response_status = p_response_status,
        last_error = null
    where id = p_delivery_id;

    v_new_status := 'sent';

    -- isk別名で明示修飾する: returns table(...)のOUT列名consecutive_failuresが
    -- 同名のplpgsql変数を暗黙宣言するため、非修飾の列参照は
    -- integration_sinks.consecutive_failures と曖昧衝突しSQLエラーになる。
    update integration_sinks isk
    set consecutive_failures = 0, last_delivered_at = now()
    where isk.id = v_sink_id
    returning isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures;

  else
    v_attempts := v_attempts + 1;

    if p_outcome = 'permanent_fail' then
      v_new_status := 'dead';
    elsif v_attempts >= array_length(v_backoff_minutes, 1) + 1 then
      v_new_status := 'dead';
    else
      v_delay_minutes := v_backoff_minutes[least(v_attempts, array_length(v_backoff_minutes, 1))];
      v_new_status := 'failed';
    end if;

    update sink_deliveries
    set status = v_new_status,
        attempts = v_attempts,
        next_attempt_at = case
          when v_new_status = 'failed' then now() + (v_delay_minutes || ' minutes')::interval
          else next_attempt_at
        end,
        response_status = p_response_status,
        last_error = left(coalesce(p_error, ''), 500)
    where id = p_delivery_id;

    select isk.status into v_prev_sink_status from integration_sinks isk where isk.id = v_sink_id for update;

    if p_counts_toward_failures then
      -- 同上: isk別名で明示修飾しないとconsecutive_failuresがOUT列名と曖昧衝突する
      update integration_sinks isk
      set consecutive_failures = isk.consecutive_failures + 1
      where isk.id = v_sink_id
      returning isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures;

      -- 20連続失敗で停止（m5: >20だと21回目まで発火せず「20連続失敗」の文言・通知と
      -- ズレるため、ちょうど20回目の失敗で発火する >= 20 に統一する）
      if v_consecutive_failures >= 20 and v_prev_sink_status = 'active' then
        update integration_sinks set status = 'error' where id = v_sink_id;
        v_sink_status := 'error';
        v_just_became_error := true;
      end if;
    else
      select isk.status, isk.consecutive_failures into v_sink_status, v_consecutive_failures
      from integration_sinks isk where isk.id = v_sink_id;
    end if;
  end if;

  return query select v_new_status, v_sink_status, v_consecutive_failures, v_just_became_error;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) rpc_reactivate_sink — 再有効化時のカウンタ・スケジュールリセット
-- -----------------------------------------------------------------------------
create or replace function public.rpc_reactivate_sink(p_sink_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update integration_sinks
  set status = 'active', consecutive_failures = 0
  where id = p_sink_id;

  update sink_deliveries
  set next_attempt_at = now()
  where sink_id = p_sink_id
    and status in ('queued', 'failed');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) rpc_redeliver_sink_delivery / rpc_redeliver_sink — 再送
-- -----------------------------------------------------------------------------
create or replace function public.rpc_redeliver_sink_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update sink_deliveries
  set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_delivery_id
    and status in ('dead', 'failed');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.rpc_redeliver_sink(p_sink_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update sink_deliveries
  set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where sink_id = p_sink_id
    and status in ('dead', 'failed');
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- service role のみ実行可（暗黙のPUBLIC grantをrevokeするため、明示grantが必須）
revoke execute on function public.rpc_claim_sink_deliveries(int, int) from public, anon, authenticated;
revoke execute on function public.rpc_complete_sink_delivery(uuid, text, int, text, boolean) from public, anon, authenticated;
revoke execute on function public.rpc_reactivate_sink(uuid) from public, anon, authenticated;
revoke execute on function public.rpc_redeliver_sink_delivery(uuid) from public, anon, authenticated;
revoke execute on function public.rpc_redeliver_sink(uuid) from public, anon, authenticated;
grant execute on function public.rpc_claim_sink_deliveries(int, int) to service_role;
grant execute on function public.rpc_complete_sink_delivery(uuid, text, int, text, boolean) to service_role;
grant execute on function public.rpc_reactivate_sink(uuid) to service_role;
grant execute on function public.rpc_redeliver_sink_delivery(uuid) to service_role;
grant execute on function public.rpc_redeliver_sink(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 9) rpc_redact_channel_message の拡張 — digestタスクtitle破壊＋dismiss連動配達
-- -----------------------------------------------------------------------------
-- §2-4: source_message_id が一致する channel_digest_tasks の title を破壊した上で
-- dismissed化する。status変化を伴うUPDATEなのでenqueueトリガーがtask.dismissed
-- （破壊済みタイトルのスナップショット）を配達し、外部の残骸を上書きする。
create or replace function public.rpc_redact_channel_message(
  p_message_id uuid,
  p_redacted_by uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update channel_messages
  set body = '[削除済み（機微情報）]',
      payload = '{}'::jsonb,
      storage_path = null,
      redacted_at = now(),
      redacted_by = p_redacted_by,
      redacted_reason = p_reason
  where id = p_message_id
    and redacted_at is null;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    -- open/done → dismissed（statusが変わるのでenqueueトリガーが発火しtask.dismissedを配達）
    update channel_digest_tasks
    set title = '[削除済み]',
        status = 'dismissed'
    where source_message_id = p_message_id
      and status <> 'dismissed';

    -- 既にdismissed済みの行もtitleは破壊する（配達済みの旧titleが外部に残る可能性は
    -- §2-4記載のとおり仕様限界としてドキュメント明記済み。DB側の証跡だけは破壊しておく）
    update channel_digest_tasks
    set title = '[削除済み]'
    where source_message_id = p_message_id
      and status = 'dismissed'
      and title <> '[削除済み]';
  end if;

  return v_updated > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) 付随修正（§2-1）: updateDigestTaskStatusConsole の空遷移no-op化はアプリ層
--     (src/lib/channels/store.ts) で対応する。ここではDB側の対応不要
--     （トリガーがold.status IS DISTINCT FROM new.statusで既に空遷移を無視するため）。
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 11) RLS
-- -----------------------------------------------------------------------------
alter table public.integration_sinks enable row level security;
alter table public.integration_sinks force row level security;
alter table public.sink_deliveries enable row level security;
alter table public.sink_deliveries force row level security;
alter table public.sink_external_refs enable row level security;
alter table public.sink_external_refs force row level security;

revoke all on table public.integration_sinks from anon, authenticated;
revoke all on table public.sink_deliveries from anon, authenticated;
revoke all on table public.sink_external_refs from anon, authenticated;

-- integration_sinks: secret_encrypted は authenticated から不可視（列レベルgrant）。
-- channel_accounts と異なり一覧・設定表示はコンソールUIに必要なため、
-- secret_encrypted以外は internal member に select 許可する。
grant select (
  id, org_id, group_id, provider, display_name, config, connection_id,
  events, status, consecutive_failures, last_delivered_at, created_by,
  created_at, updated_at
) on table public.integration_sinks to authenticated;

grant select on table public.sink_deliveries to authenticated;
grant select on table public.sink_external_refs to authenticated;

drop policy if exists integration_sinks_select_internal on public.integration_sinks;
create policy integration_sinks_select_internal
  on public.integration_sinks
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

drop policy if exists sink_deliveries_select_internal on public.sink_deliveries;
create policy sink_deliveries_select_internal
  on public.sink_deliveries
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- sink_external_refsはorg_idを持たないため、親sinkのorg境界に委譲する
drop policy if exists sink_external_refs_select_internal on public.sink_external_refs;
create policy sink_external_refs_select_internal
  on public.sink_external_refs
  for select
  to authenticated
  using (
    exists (
      select 1 from integration_sinks s
      where s.id = sink_external_refs.sink_id
        and public.app_is_org_internal(s.org_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 12) 配送ワーカー cron（pg_cron → pg_net、5分間隔）
-- -----------------------------------------------------------------------------
-- 未設定の環境向けの手作業（1回だけ、cron_secretはclient-reminders/channel-digestと共有）:
--   select vault.create_secret('https://agentpm.app/api/cron/sink-dispatch', 'cron_sink_dispatch_url');
create or replace function public.app_invoke_sink_dispatch()
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
    from vault.decrypted_secrets where name = 'cron_sink_dispatch_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'sink dispatch: vault secrets (cron_sink_dispatch_url / cron_secret) が未設定です';
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

revoke all on function public.app_invoke_sink_dispatch() from public;
revoke all on function public.app_invoke_sink_dispatch() from anon;
revoke all on function public.app_invoke_sink_dispatch() from authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'sink-dispatch') then
      perform cron.schedule('sink-dispatch', '*/5 * * * *', 'select app_invoke_sink_dispatch()');
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後にservice roleで実施。docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §10参照。
-- このPR-1でカバーするのは受け入れ基準1〜11。12(グループ再リンクでsink disabled)・
-- 13(Notion upsert)は後続PRのスコープ）:
--   1) digest抽出と同一Txでenqueueされる: rpc_ingest_digest_tasks呼び出し内でinsertされた
--      channel_digest_tasks行に対しtrg_channel_digest_tasks_enqueue_sink_deliveriesが
--      同一トランザクションで発火することを確認（Tx内でロールバックすればenqueueも消える）
--   2) done→reopen→done: 3回のUPDATEそれぞれでevent_keyが異なりsink_deliveriesに3行できる
--   3) postback/「完了N」/コンソール/relink auto-dismissいずれも channel_digest_tasks の
--      UPDATE経由のため、既存の全消し込み経路でトリガーが漏れなく発火する
--   4) rpc_redact_channel_message実行後、対象タスクのtitleが'[削除済み]'になり
--      status='dismissed'のsink_deliveries行(event_type='task.dismissed')が作られる
--   5)-11) は src/lib/sinks/* の単体テスト（signature/backoff/ssrf/store/dispatcher）参照。
--     7,8はrpc_complete_sink_delivery・rpc_reactivate_sinkの直接呼び出しで確認可能。
--     10はsecret_encryptedをauthenticatedでselectしてpermission deniedになることを確認、
--     別orgのsink/deliveriesがRLSで0件になることを確認
--   11) sink をstatus='disabled'にしてもsink_deliveriesが引き続きselectできることを確認
--       （物理DELETEはtrg_integration_sinks_no_deleteで拒否されることも確認）
-- ロールバック:
--   select cron.unschedule('sink-dispatch');
--   drop function app_invoke_sink_dispatch();
--   drop function rpc_redeliver_sink(uuid), rpc_redeliver_sink_delivery(uuid),
--     rpc_reactivate_sink(uuid), rpc_complete_sink_delivery(uuid,text,int,text,boolean),
--     rpc_claim_sink_deliveries(int,int);
--   drop trigger trg_channel_digest_tasks_enqueue_sink_deliveries on channel_digest_tasks;
--   drop function channel_digest_tasks_enqueue_sink_deliveries();
--   drop table sink_external_refs;
--   drop table sink_deliveries;
--   drop trigger trg_integration_sinks_touch_updated_at on integration_sinks;
--   drop trigger trg_integration_sinks_no_delete on integration_sinks;
--   drop function integration_sinks_touch_updated_at(), integration_sinks_no_delete();
--   drop table integration_sinks;
--   alter table integration_connections drop constraint integration_connections_provider_check;
--   alter table integration_connections add constraint integration_connections_provider_check
--     check (provider in ('google_calendar','zoom','google_meet','teams'));
--   （rpc_redact_channel_message は20260710204722のcreate or replaceを再適用してStage2版に戻す）
-- =============================================================================
