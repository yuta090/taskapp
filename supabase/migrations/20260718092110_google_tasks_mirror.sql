-- =============================================================================
-- Google Tasks 個人ミラー基盤（Stage1/2）
--
-- LINE 由来の「自分向けタスク」を、担当者本人の Google Tasks(個人リスト "TaskApp")へ
-- 片方向ミラーし、Google 側の完了を TaskApp へ逆流させる。設計判断(Fable, 2026-07-17):
--   - ミラー条件 = assignee_id=本人 かつ status∈(todo,in_progress) かつ space.type='project'。
--     ball は条件に入れない(ball は「誰が次に動くか」で「誰のタスクか」ではない)。
--   - 既存 sink 基盤(integration_sinks)とは別建て(sink は org 単位の単一配達先で噛み合わない)。
--     claim/backoff のアウトボックス様式だけ踏襲する。
--   - 対応表 user_task_mirror_refs が Google task の唯一の対応正(notes に ID は埋めない)。
--   - 逆流は「Google 完了 → TaskApp status='done'」の一方向のみ。ball は触らない。
--
-- 適用: アプリ稼働中に本番共用DBへ適用可(新規オブジェクトのみ・既存を壊さない)。
--   provider CHECK の入れ替えだけ既存テーブルに触るが、値の追加のみで既存行に影響しない。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) integration_connections: provider に google_tasks を追加
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in ('google_calendar', 'zoom', 'google_meet', 'teams', 'notion', 'google_sheets', 'google_tasks'));

-- -----------------------------------------------------------------------------
-- 1) 対応表: TaskApp task <-> Google task (接続ごと)
--    Google Tasks には外部IDフィールドが無いため、この表が対応関係の唯一の正。
-- -----------------------------------------------------------------------------
create table if not exists public.user_task_mirror_refs (
  connection_id     uuid not null references public.integration_connections(id) on delete cascade,
  -- task_id は tasks への FK を張らない。タスク削除時に AFTER DELETE トリガーが「Google からも消す」
  -- delete ジョブを作るが、FK cascade だと task 削除で refs も消え Google task ID を引けなくなる。
  -- 識別子として保持し、ワーカーが Google 削除を終えたらこの行を掃除する。
  task_id           uuid not null,
  google_tasklist_id text not null,
  google_task_id    text not null,
  state             text not null default 'active' check (state in ('active', 'orphaned')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (connection_id, task_id)
);
comment on table public.user_task_mirror_refs is
  'TaskApp task と Google task の対応表(接続ごと)。Google Tasks に外部IDフィールドが無いため対応の唯一の正。notes にIDは埋めない。task_id は FK を張らない(削除ジョブが Google ID を要するため)。';

-- -----------------------------------------------------------------------------
-- 2) アウトボックス: ミラー配達ジョブ
--    (connection_id, task_id) につき pending は1件(最新状態)。tasks トリガーが upsert する。
-- -----------------------------------------------------------------------------
create table if not exists public.user_task_mirror_jobs (
  id              uuid primary key default gen_random_uuid(),
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  -- task_id は tasks への FK を張らない(refs と同理由)。AFTER DELETE トリガーが task 消滅後に
  -- delete ジョブを作るため、FK cascade だと job を作れない/即消される。
  task_id         uuid not null,
  op              text not null check (op in ('upsert', 'complete', 'delete')),
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempt         int not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- version: enqueue で fold されるたび +1。claim が捕捉し complete で照合する。
  --   処理中に fold（新しい op で上書き）されると version が進み、古い worker の complete が
  --   version 不一致で弾かれる → 最新 op を捨てず pending のまま次サイクルで配達する。
  version         bigint not null default 1,
  -- leased_until: 実行中リース（in-flight）。next_attempt_at（バックオフ予定）とは分離する。
  --   相乗りさせると enqueue の fold（next_attempt_at=now() リセット）が lease を壊し二重 claim を招く。
  --   null=未リース。claim 中は now()+10分。complete で null に戻す。
  leased_until    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.user_task_mirror_jobs is
  'Google Tasks ミラーのアウトボックス。(connection_id,task_id)につきpendingは最新1件。順方向ワーカーがclaimして配達する。';

-- (connection, task) につき pending は最新1件だけ。enqueue は on conflict で payload/op を上書きする。
create unique index if not exists user_task_mirror_jobs_pending_unique
  on public.user_task_mirror_jobs (connection_id, task_id)
  where status = 'pending';

create index if not exists user_task_mirror_jobs_claim_idx
  on public.user_task_mirror_jobs (next_attempt_at)
  where status = 'pending';

-- refs/jobs は service role(ワーカー)専用。authenticated からは触らせない(RLS有効・policyなし)。
alter table public.user_task_mirror_refs enable row level security;
alter table public.user_task_mirror_jobs enable row level security;

-- -----------------------------------------------------------------------------
-- 3) ミラー対象判定 + enqueue トリガー
-- -----------------------------------------------------------------------------

-- ある tasks 行がミラー対象か: assignee 本人 / status∈(todo,in_progress) / project space /
-- assignee が active な google_tasks 接続を持つ。
create or replace function public._task_is_mirror_target(t public.tasks)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select t.assignee_id is not null
     and t.status in ('todo', 'in_progress')
     and exists (select 1 from public.spaces s where s.id = t.space_id and s.type = 'project')
     and exists (
       select 1 from public.integration_connections c
       where c.owner_type = 'user' and c.owner_id = t.assignee_id
         and c.provider = 'google_tasks' and c.status = 'active'
     );
$$;

-- assignee 本人の active な google_tasks 接続IDを返す(無ければ null)。
create or replace function public._google_tasks_connection_for(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.integration_connections c
  where c.owner_type = 'user' and c.owner_id = p_user
    and c.provider = 'google_tasks' and c.status = 'active'
  limit 1;
$$;

-- pending ジョブを最新状態で upsert する(同一 connection,task の pending は1件に畳む)。
create or replace function public._enqueue_task_mirror_job(
  p_connection uuid, p_task uuid, p_op text, p_payload jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_task_mirror_jobs (connection_id, task_id, op, payload, status, next_attempt_at)
  values (p_connection, p_task, p_op, p_payload, 'pending', now())
  on conflict (connection_id, task_id) where status = 'pending'
  -- fold: op/payload を最新に上書きし attempt/next_attempt_at をリセット。version は必ず +1
  -- （処理中の worker に「あなたが取ったものは古い」と伝える鍵）。leased_until は触らない
  -- （実行中リースは claim/complete が管理する。ここでリセットすると二重 claim を招く）。
  do update set op = excluded.op, payload = excluded.payload,
                attempt = 0, next_attempt_at = now(), last_error = null,
                version = public.user_task_mirror_jobs.version + 1, updated_at = now();
$$;

-- tasks の AFTER INSERT/UPDATE/DELETE で、対象への出入り・内容変化を検知して enqueue する。
create or replace function public.enqueue_task_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_target  boolean := false;   -- NEW が対象か
  v_was_target boolean := false;   -- OLD が対象だったか
  v_new_conn   uuid;
  v_old_conn   uuid;
  v_payload    jsonb;
  v_glist      text;
  v_gid        text;
  v_notes      constant text := 'TaskApp と同期中のタスクです。担当変更・削除でこのタスクも消えます。';
begin
  if TG_OP <> 'DELETE' then
    v_is_target := public._task_is_mirror_target(NEW);
  end if;
  if TG_OP <> 'INSERT' then
    v_was_target := public._task_is_mirror_target(OLD);
  end if;

  if not v_is_target and not v_was_target then
    return coalesce(NEW, OLD);
  end if;

  if v_is_target then
    v_new_conn := public._google_tasks_connection_for(NEW.assignee_id);
  end if;
  if v_was_target then
    v_old_conn := public._google_tasks_connection_for(OLD.assignee_id);
  end if;

  -- NEW 側: 参入 or 内容更新 → upsert(最新スナップショット)
  if v_is_target and v_new_conn is not null then
    v_payload := jsonb_build_object(
      'title', NEW.title,
      'notes', v_notes,
      'due_date', NEW.due_date,
      'status', NEW.status
    );
    perform public._enqueue_task_mirror_job(v_new_conn, NEW.id, 'upsert', v_payload);
  end if;

  -- OLD 側: 離脱の後始末。NEW と同じ接続に留まる場合は上の upsert で足りるので何もしない。
  if v_was_target and v_old_conn is not null
     and (v_new_conn is null or v_new_conn <> v_old_conn) then
    -- Google 側の task ID を refs から payload に埋める(task 削除後もワーカーが refs 参照せず消せるように)。
    -- refs が無い(まだ Google 未作成)なら null → ワーカーは消すものが無いとして skip する。
    select r.google_tasklist_id, r.google_task_id into v_glist, v_gid
      from public.user_task_mirror_refs r
      where r.connection_id = v_old_conn and r.task_id = OLD.id;
    v_payload := jsonb_build_object('google_tasklist_id', v_glist, 'google_task_id', v_gid);

    if TG_OP <> 'DELETE' and NEW.status = 'done' and NEW.assignee_id = OLD.assignee_id then
      -- 同一担当のまま完了 → Google 側も完了に(ball は触らない)
      perform public._enqueue_task_mirror_job(v_old_conn, OLD.id, 'complete', v_payload);
    else
      -- 担当替え / 対象外ステータス化 / 削除 → 旧担当の Google からは消す
      perform public._enqueue_task_mirror_job(v_old_conn, OLD.id, 'delete', v_payload);
    end if;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_enqueue_task_mirror on public.tasks;
create trigger trg_enqueue_task_mirror
  after insert or update or delete on public.tasks
  for each row execute function public.enqueue_task_mirror();

-- -----------------------------------------------------------------------------
-- 4) claim RPC: pending を lease してワーカーへ払い出す(for update skip locked)
-- -----------------------------------------------------------------------------
create or replace function public.rpc_claim_task_mirror_jobs(
  p_total_limit int default 100,
  p_per_conn_limit int default 20
)
returns setof public.user_task_mirror_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  -- lease は cron 間隔(5分)×2 を目安に 10 分。バッチを接続ごと逐次処理する間に
  -- lease 切れで二重 claim される窓を塞ぐ。next_attempt_at ではなく leased_until を進める。
  v_lease_until timestamptz := now() + interval '10 minutes';
begin
  return query
  with candidates as (
    select j.id, j.connection_id, j.next_attempt_at
    from public.user_task_mirror_jobs j
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
  update public.user_task_mirror_jobs j
  set leased_until = v_lease_until  -- next_attempt_at は触らない（fold と衝突させない）
  from chosen
  where j.id = chosen.id
  returning j.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) complete RPC: 配達結果を確定(バックオフ・dead 化)
--    p_outcome: 'done' | 'temporary_fail' | 'permanent_fail'
--    バックオフ(1分→5分→30分→2時間→6時間・最大6試行)は sink と同値。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_complete_task_mirror_job(
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
    from public.user_task_mirror_jobs where id = p_job_id for update;
  if not found then return; end if;
  if v_status <> 'pending' then return; end if;  -- done/dead は終端・不変

  if v_version <> p_version then
    -- 処理中に fold された（この worker が処理したのは古い op）。最新 op は既に pending
    -- (attempt=0, next_attempt_at=now()) で入っている。lease だけ解いて即再配達可能にする。
    update public.user_task_mirror_jobs
      set leased_until = null, updated_at = now()
      where id = p_job_id;
    return;
  end if;

  -- version 一致：この worker の処理結果を確定する。どの分岐でも lease を解く。
  if p_outcome = 'done' then
    update public.user_task_mirror_jobs
      set status = 'done', last_error = null, leased_until = null, updated_at = now()
      where id = p_job_id;
  elsif p_outcome = 'permanent_fail' then
    update public.user_task_mirror_jobs
      set status = 'dead', last_error = p_error, leased_until = null, updated_at = now()
      where id = p_job_id;
  else  -- temporary_fail
    if v_attempt + 1 >= array_length(v_backoff, 1) + 1 then
      update public.user_task_mirror_jobs
        set status = 'dead', attempt = v_attempt + 1, last_error = p_error,
            leased_until = null, updated_at = now()
        where id = p_job_id;
    else
      v_delay := v_backoff[v_attempt + 1];
      update public.user_task_mirror_jobs
        set attempt = v_attempt + 1,
            next_attempt_at = now() + make_interval(mins => v_delay),
            last_error = p_error, leased_until = null, updated_at = now()
        where id = p_job_id;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) 逆流 RPC: Google 側の完了を TaskApp へ。status='done' に(既に done なら no-op)。ball は触らない。
--    条件付き更新なので、既に done の行は UPDATE 0件 → tasks トリガーも発火せずループしない。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_mirror_complete_task(p_connection_id uuid, p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  -- 誤完了ガード: 「その接続の所有者が今も担当」かつ「ref が現存」する場合のみ done 化する。
  -- 担当替え後に旧担当の Google 完了が別担当のタスクを done 化する事故を防ぐ（ref は削除ジョブ
  -- 完了時に消えるので、既に付け替え済みなら 0 件になる）。既に done なら条件で 0 件＝ループ防止。
  update public.tasks t
    set status = 'done', updated_at = now()
    where t.id = p_task_id
      and t.status <> 'done'
      and t.assignee_id = (
        select c.owner_id from public.integration_connections c
        where c.id = p_connection_id and c.provider = 'google_tasks' and c.owner_type = 'user'
      )
      and exists (
        select 1 from public.user_task_mirror_refs r
        where r.connection_id = p_connection_id and r.task_id = p_task_id
      );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6b) 接続時バックフィル: 既存のミラー対象タスクを一括 enqueue する。
--     トリガーは将来の変更しか拾わないため、接続直後に一度これを呼んで既存分を同期する。
-- -----------------------------------------------------------------------------
create or replace function public.rpc_backfill_task_mirror(p_connection_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_count int := 0;
  r record;
  v_notes constant text := 'TaskApp と同期中のタスクです。担当変更・削除でこのタスクも消えます。';
begin
  select owner_id into v_owner from public.integration_connections
    where id = p_connection_id and provider = 'google_tasks' and owner_type = 'user' and status = 'active';
  if v_owner is null then return 0; end if;

  for r in
    select t.id, t.title, t.due_date, t.status
    from public.tasks t
    join public.spaces s on s.id = t.space_id and s.type = 'project'
    where t.assignee_id = v_owner and t.status in ('todo', 'in_progress')
  loop
    perform public._enqueue_task_mirror_job(
      p_connection_id, r.id, 'upsert',
      jsonb_build_object('title', r.title, 'notes', v_notes, 'due_date', r.due_date, 'status', r.status)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6c) 権限: 上記の新規関数はすべて service role(ワーカー/callback)専用にする。
--     Postgres は新規関数の EXECUTE を既定で PUBLIC に付与するため、明示 revoke しないと
--     anon/authenticated が SECURITY DEFINER の rpc を直接叩けてしまう
--     (例: rpc_mirror_complete_task で任意タスクを done 化、claim で outbox を読み出し)。
--     ヘルパ/トリガー関数は内部呼び出し・トリガー発火で動くので grant は不要(revoke のみ)。
-- -----------------------------------------------------------------------------
revoke all on function public._task_is_mirror_target(public.tasks) from public, anon, authenticated;
revoke all on function public._google_tasks_connection_for(uuid) from public, anon, authenticated;
revoke all on function public._enqueue_task_mirror_job(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_task_mirror() from public, anon, authenticated;
revoke all on function public.rpc_claim_task_mirror_jobs(int, int) from public, anon, authenticated;
revoke all on function public.rpc_complete_task_mirror_job(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.rpc_mirror_complete_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_backfill_task_mirror(uuid) from public, anon, authenticated;

grant execute on function public.rpc_claim_task_mirror_jobs(int, int) to service_role;
grant execute on function public.rpc_complete_task_mirror_job(uuid, bigint, text, text) to service_role;
grant execute on function public.rpc_mirror_complete_task(uuid, uuid) to service_role;
grant execute on function public.rpc_backfill_task_mirror(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7) pg_cron: 順方向 dispatch と逆流 poll を起動(vault の URL/secret を net.http_post)
--    URL/secret の vault 登録は本番運用で別途行う(sink-dispatch と同じ方式)。
-- -----------------------------------------------------------------------------
create or replace function public.app_invoke_task_mirror(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'cron_task_mirror_' || p_kind || '_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'task mirror(%): vault secrets 未設定', p_kind;
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_task_mirror(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'task-mirror-dispatch') then
      perform cron.schedule('task-mirror-dispatch', '*/5 * * * *', $cron$select app_invoke_task_mirror('dispatch')$cron$);
    end if;
    -- 逆流ポーリングは15分間隔(クォータ: 96req/日/接続。updatedMin で差分)
    if not exists (select 1 from cron.job where jobname = 'task-mirror-poll') then
      perform cron.schedule('task-mirror-poll', '*/15 * * * *', $cron$select app_invoke_task_mirror('poll')$cron$);
    end if;
  end if;
end $$;
