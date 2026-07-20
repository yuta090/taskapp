-- =============================================================================
-- 双方向同期コネクタ層（構造のみ・Stage: 表とRPC）
--
-- TaskApp の tasks 行をハブに、外部ツール(multica / gtasks 等)と双方向同期するための
-- connector 層。設計判断(Fable, 2026-07-20):
--   - 既存 sink(integration_sinks)とは別建て。sink は org 単位の単一配達先(片方向・fan-out)で、
--     「接続単位の取り込み × タスク単位の origin(正本)」という双方向の第一級モデルと噛み合わない。
--     アウトボックス様式(fold+version+lease+backoff)だけを既存 gtasks ミラーから踏襲する。
--   - 正本は二段: (a)接続単位の import_enabled=「この接続の外部ツールが正本＝外部から取り込む」、
--     (b)タスク単位の connector_task_links.origin(internal|external)=そのタスク行の出自。
--     完了の書き戻し先は origin で決まる(契約 §1)。
--   - トポロジはハブ&スポーク: multica と gtasks は直結せず、必ず tasks 行を経由する(契約 §2)。
--   - ループ遮断は「観測状態と異なるときだけ書く」条件付き更新。完了は done を吸収状態とし、
--     status<>'done' のときだけ done 化 → 0 件なら DB トリガーも発火せず反響が物理停止する。
--     エコー用のマーキングはしない(契約 §6)。
--   - task_id は tasks への FK を張らない。削除ジョブが task 消滅後も外部IDを引く必要があり、
--     FK cascade だと link/job が task 削除で即消え外部側を掃除できなくなる
--     (既存 user_task_mirror_refs の同理由。gtasks migration 32-34行に同旨)。
--
-- この migration の範囲(構造のみ):
--   - integration_connections の非破壊拡張(provider に multica 追加 + import_* / poll_cursor 列)
--   - connector_task_links(対応表) / connector_jobs(アウトボックス) / connector_inbound_events(受信冪等)
--   - claim / complete_job / connector_complete_task の3 RPC + ヘルパの権限
-- スコープ外(後続PR):
--   - tasks の変更を connector_jobs に enqueue する振り分けトリガー(対象タスク選定則が未確定)
--   - pg_cron による dispatch/poll 起動(worker 実装が固まってから)
--   - import_config の中身の仕様 / import 先 space/assignee 決定則
--
-- 適用: アプリ稼働中に本番共用DBへ適用可(新規オブジェクト + 列追加のみ・既存行に影響しない)。
--   既存の user_task_mirror_* テーブル・関数・cron は一切触らない(動作中のものを壊さない。統合は将来判断)。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) integration_connections: provider に multica を追加 + connector 用の列を追加
--    provider は drop→add(値追加のみ・既存行に影響なし)。列は not null default 付きで安全に追加。
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in ('google_calendar', 'zoom', 'google_meet', 'teams', 'notion', 'google_sheets', 'google_tasks', 'multica'));

-- import_enabled: この接続の外部ツールを正本として TaskApp へ取り込むか(正本の二段のうち接続単位)。
alter table public.integration_connections
  add column if not exists import_enabled boolean not null default false;
comment on column public.integration_connections.import_enabled is
  '双方向同期: この接続の外部ツールが正本＝外部からタスクを取り込む実体。default false(既存接続は取り込まない)。';

-- import_config: import 対象の指定(読み取り対象リスト・生成先 space/assignee 等)。器だけ。中身は後続PR。
alter table public.integration_connections
  add column if not exists import_config jsonb not null default '{}'::jsonb;
comment on column public.integration_connections.import_config is
  '双方向同期: import 対象の指定(読取対象リスト・生成先 space/assignee 等)。中身の仕様は後続PRで確定。';

-- poll_cursor: ポーリングの updatedMin カーソル。metadata JSON からの read-modify-write 競合
--   (mirror.ts の既知問題)を避けるため専用列へ分離。connector で書込契機が増えるため恒久列化する。
alter table public.integration_connections
  add column if not exists poll_cursor text;
comment on column public.integration_connections.poll_cursor is
  '双方向同期: ポーリングの updatedMin カーソル。metadata JSON からの read-modify-write 競合回避のため専用列化。';

-- -----------------------------------------------------------------------------
-- 1) 対応表: TaskApp task <-> 外部 Issue/task (接続ごと)
--    外部側ID(multica の issue_id / gtasks の id)と TaskApp tasks.id を結ぶ唯一の正。
-- -----------------------------------------------------------------------------
create table if not exists public.connector_task_links (
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  -- task_id は tasks への FK を張らない(user_task_mirror_refs と同理由)。削除ジョブが task 消滅後も
  -- external_id を引くため、FK cascade だと task 削除でこの行が消え外部側を掃除できなくなる。
  -- 識別子として保持し、ワーカーが外部側の削除/クローズを終えたらこの行を掃除する。
  task_id         uuid not null,
  external_id     text not null,   -- 相手側ID(multica の issue_id / gtasks の id)
  external_list_id text,           -- 相手側の親コンテナID(gtasks の tasklist 等)。無ければ null
  origin          text not null check (origin in ('internal', 'external')),
  state           text not null default 'active' check (state in ('active', 'orphaned')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (connection_id, task_id),
  -- 再 import の重複を構造的に禁止(同一接続で同じ外部IDは1タスクにしか結び付かない)。
  unique (connection_id, external_id)
);
comment on table public.connector_task_links is
  'TaskApp task と外部 Issue/task の対応表(接続ごと)。origin でそのタスク行の正本を表す。task_id は FK を張らない(削除ジョブが外部IDを要するため)。unique(connection_id,external_id) で再importの重複を禁止。';

-- link は service role(ワーカー/callback)専用。authenticated からは触らせない(RLS有効・policyなし)。
alter table public.connector_task_links enable row level security;

-- -----------------------------------------------------------------------------
-- 2) アウトボックス: TaskApp → 外部 の配達ジョブ(user_task_mirror_jobs と同型)
--    (connection_id, task_id) につき pending は1件(最新状態に fold)。
--    ※ enqueue する振り分けトリガーは本PRでは作らない(対象選定則が未確定)。表と index だけ用意。
-- -----------------------------------------------------------------------------
create table if not exists public.connector_jobs (
  id              uuid primary key default gen_random_uuid(),
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  -- task_id は tasks への FK を張らない(links/mirror_jobs と同理由)。cancel ジョブは task 消滅後も走る。
  task_id         uuid not null,
  op              text not null check (op in ('upsert', 'cancel', 'complete')),
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempt         int not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- version: enqueue で fold されるたび +1。claim が捕捉し complete で照合する。
  --   処理中に fold されると version が進み、古い worker の complete が version 不一致で弾かれる
  --   → 最新 op を捨てず pending のまま次サイクルで配達する。
  version         bigint not null default 1,
  -- leased_until: 実行中リース(in-flight)。next_attempt_at(バックオフ予定)とは分離する。
  --   相乗りさせると fold(next_attempt_at=now() リセット)が lease を壊し二重 claim を招く。
  --   null=未リース。claim 中は now()+10分。complete で null に戻す。
  leased_until    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.connector_jobs is
  'コネクタ送信(TaskApp→外部)のアウトボックス。(connection_id,task_id)につきpendingは最新1件。順方向ワーカーがclaimして配達する。user_task_mirror_jobs と同型。';

-- (connection, task) につき pending は最新1件だけ。将来の enqueue は on conflict で fold する。
create unique index if not exists connector_jobs_pending_unique
  on public.connector_jobs (connection_id, task_id)
  where status = 'pending';

create index if not exists connector_jobs_claim_idx
  on public.connector_jobs (next_attempt_at)
  where status = 'pending';

-- jobs は service role(ワーカー)専用(RLS有効・policyなし)。
alter table public.connector_jobs enable row level security;

-- -----------------------------------------------------------------------------
-- 3) 受信冪等記録: 外部 → TaskApp の Webhook 重複配送を握る
--    unique(connection_id, event_id) で、再送は insert 失敗として検知し 200 で握る(契約 §6/§7)。
-- -----------------------------------------------------------------------------
create table if not exists public.connector_inbound_events (
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  event_id      text not null,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  primary key (connection_id, event_id)
);
comment on table public.connector_inbound_events is
  'コネクタ受信(外部→TaskApp)の冪等記録。Webhook 重複配送を primary key(connection_id,event_id) の insert 失敗で検知して握る。';

-- 受信記録は service role(callback)専用(RLS有効・policyなし)。
alter table public.connector_inbound_events enable row level security;

-- -----------------------------------------------------------------------------
-- 4) claim RPC: pending を lease してワーカーへ払い出す(for update skip locked)
--    rpc_claim_task_mirror_jobs の汎用名クローン。10分lease・接続別上限。
--
-- 【既知の残余リスク（gtasks版と同一・意図的に許容）】
--   lease 失効後の再 claim では version が変わらず、同一 version の worker が2つ存在しうる。
--   10分 lease＋処理前 lease チェックで窓は極小だが、外部 API が fencing token を持たない場合の
--   二重実行/順序逆転は原理的に残る。exactly-once は不可能なため at-least-once＋best-effort とし、
--   受信側の冪等(§3)と孤児 sweep(後続)で吸収する。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_claim_connector_jobs(
  p_total_limit int default 100,
  p_per_conn_limit int default 20
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  -- lease は cron 間隔×2 を目安に 10 分。接続ごと逐次処理する間の lease 切れ二重 claim を塞ぐ。
  v_lease_until timestamptz := now() + interval '10 minutes';
begin
  return query
  with candidates as (
    select j.id, j.connection_id, j.next_attempt_at
    from public.connector_jobs j
    join public.integration_connections c on c.id = j.connection_id
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and (j.leased_until is null or j.leased_until <= now())  -- 実行中(リース有効)の行は取らない
      and c.status = 'active'
    order by j.next_attempt_at asc
    limit greatest(p_total_limit * 10, 1000)
    for update of j skip locked
  ),
  ranked as (
    select cand.id, cand.next_attempt_at,
           row_number() over (partition by cand.connection_id order by cand.next_attempt_at asc) as rn
    from candidates cand
  ),
  chosen as (
    select id from ranked where rn <= p_per_conn_limit
    order by next_attempt_at asc limit p_total_limit
  )
  update public.connector_jobs j
  set leased_until = v_lease_until  -- next_attempt_at は触らない(fold と衝突させない)
  from chosen
  where j.id = chosen.id
  returning j.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) complete RPC: 配達結果を確定(version照合・バックオフ・dead化)
--    rpc_complete_task_mirror_job の汎用名クローン。
--    p_outcome: 'done' | 'temporary_fail' | 'permanent_fail'
--    バックオフ(1分→5分→30分→2時間→6時間・最大6試行)は gtasks/sink と同値。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_complete_connector_job(
  p_job_id uuid,
  p_version bigint,
  p_outcome text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt int;
  v_version bigint;
  v_status text;
  v_backoff constant int[] := array[1, 5, 30, 120, 360];  -- 分
  v_delay int;
begin
  select attempt, version, status into v_attempt, v_version, v_status
    from public.connector_jobs where id = p_job_id for update;
  if not found then return; end if;
  if v_status <> 'pending' then return; end if;  -- done/dead は終端・不変

  if v_version <> p_version then
    -- 処理中に fold された(この worker が処理したのは古い op)。最新 op は既に pending
    -- (attempt=0, next_attempt_at=now()) で入っている。lease だけ解いて即再配達可能にする。
    update public.connector_jobs
      set leased_until = null, updated_at = now()
      where id = p_job_id;
    return;
  end if;

  -- version 一致: この worker の処理結果を確定する。どの分岐でも lease を解く。
  if p_outcome = 'done' then
    update public.connector_jobs
      set status = 'done', last_error = null, leased_until = null, updated_at = now()
      where id = p_job_id;
  elsif p_outcome = 'permanent_fail' then
    update public.connector_jobs
      set status = 'dead', last_error = p_error, leased_until = null, updated_at = now()
      where id = p_job_id;
  else  -- temporary_fail
    if v_attempt + 1 >= array_length(v_backoff, 1) + 1 then
      update public.connector_jobs
        set status = 'dead', attempt = v_attempt + 1, last_error = p_error,
            leased_until = null, updated_at = now()
        where id = p_job_id;
    else
      v_delay := v_backoff[v_attempt + 1];
      update public.connector_jobs
        set attempt = v_attempt + 1,
            next_attempt_at = now() + make_interval(mins => v_delay),
            last_error = p_error, leased_until = null, updated_at = now()
        where id = p_job_id;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) 条件付き完了 RPC: 外部の完了を TaskApp へ。status='done' に(既に done なら 0 件)。ball は触らない。
--    rpc_mirror_complete_task と同型。条件付き更新なので、既に done の行は UPDATE 0件 →
--    tasks トリガーも発火せずループしない(契約 §4.1 / §6)。
--    誤完了ガード: connector_task_links に該当行が存在するときだけ done 化する
--    (gtasks版の assignee 一致ガードは connector では link 存在で代替する)。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_connector_complete_task(p_connection_id uuid, p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.tasks t
    set status = 'done', updated_at = now()
    where t.id = p_task_id
      and t.status <> 'done'
      and exists (
        select 1 from public.connector_task_links l
        where l.connection_id = p_connection_id and l.task_id = p_task_id
      );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) 権限: 新規関数はすべて service role(ワーカー/callback)専用にする。
--    Postgres は新規関数の EXECUTE を既定で PUBLIC に付与するため、明示 revoke しないと
--    anon/authenticated が SECURITY DEFINER の rpc を直接叩けてしまう
--    (例: rpc_connector_complete_task で任意タスクを done 化、claim で outbox を読み出し)。
--    外から叩く3つ(claim/complete_job/connector_complete_task)だけ service_role に grant する。
-- -----------------------------------------------------------------------------
revoke all on function public.rpc_claim_connector_jobs(int, int) from public, anon, authenticated;
revoke all on function public.rpc_complete_connector_job(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.rpc_connector_complete_task(uuid, uuid) from public, anon, authenticated;

grant execute on function public.rpc_claim_connector_jobs(int, int) to service_role;
grant execute on function public.rpc_complete_connector_job(uuid, bigint, text, text) to service_role;
grant execute on function public.rpc_connector_complete_task(uuid, uuid) to service_role;
