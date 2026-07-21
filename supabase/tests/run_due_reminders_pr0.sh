#!/usr/bin/env bash
# =============================================================================
# 期限リマインド PR-0 migration 検証ハーネス（throwaway クラスタ）
#
# 20260721133427_due_reminder_pr0.sql の境界を throwaway PG クラスタで検証する。
#   (A) 読取専用ガードトリガー: service_role 通過 / authenticated 拒否 / WHEN 節絞り込み /
#       権威NULL は編集可 / 接続 delete で権威 NULL 化。
#   (B) backfill: external link 1件→その接続 / 複数→created_at 最古の接続 / internal のみ→NULL。
#   (C) occurrences claim/finalize: skip locked で二重取得なし / lease失効の再claim /
#       finalize sent/suppressed/deferred(pending差戻し)・deferred 上限で canceled。
#   (D) _enqueue_connector_job: 同(connection,task)2回→pending 1件に fold・version 前進。
#
# 使い捨てクラスタを起動し終了時に破棄。本番DBには触れない。
# 使い方: bash supabase/tests/run_due_reminders_pr0.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/dr0.XXXXXX)"
PGDATA="$WORK/data"
SOCK="$WORK/s"
PORT=54419
mkdir -p "$SOCK"

cleanup() {
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

echo "== bootstrap: roles / auth.role / 依存テーブル + backfill 対象データ =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
-- migration のガードは auth.role() を GUC(request.jwt.claim.role) から読む。本番 GoTrue と同形。
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;

-- 依存: integration_connections / tasks / connector_task_links / connector_jobs（実チェーンでは
-- 先行 migration が作る。ここでは migration が触る列と test が要する列だけを最小構成で用意する）。
create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  status text not null default 'active',
  provider text
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, space_id uuid, title text not null default '',
  status text not null default 'todo',
  due_date date,
  updated_at timestamptz not null default now()
);
create table connector_task_links (
  connection_id uuid not null references integration_connections(id) on delete cascade,
  task_id uuid not null,
  external_id text not null,
  origin text not null check (origin in ('internal','external')),
  created_at timestamptz not null default now(),
  primary key (connection_id, task_id),
  unique (connection_id, external_id)
);
-- connector_jobs: _enqueue_connector_job が触る列＋ON CONFLICT が要する partial unique index。
create table connector_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  task_id uuid not null,
  op text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt int not null default 0,
  next_attempt_at timestamptz not null default now(),
  version bigint not null default 1,
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index connector_jobs_pending_unique
  on connector_jobs (connection_id, task_id) where status = 'pending';

-- 接続 A/B(google_tasks=dueImport) / M(multica=due無し・権威に選ばれてはいけない)
insert into integration_connections (id, org_id, status, provider) values
  ('a0000000-0000-4000-a000-000000000001','11111111-0000-4000-a000-000000000000','active','google_tasks'),
  ('b0000000-0000-4000-a000-000000000002','11111111-0000-4000-a000-000000000000','active','google_tasks'),
  ('90000000-0000-4000-a000-000000000009','11111111-0000-4000-a000-000000000000','active','multica');

-- backfill 対象タスク:
--  t1: external link 1件(接続A) → 権威=A
--  t2: external link 2件(接続A=新しい / 接続B=古い・両 gtasks) → 権威=B（created_at 最古）
--  t3: internal link のみ → 権威=NULL
--  t4: link 無し(TaskApp発) → 権威=NULL
--  t5: multica external link のみ → 権威=NULL（provider ゲートで除外・due 後付け可能であるべき）
--  t6: gtasks(A) + multica(M) 両 external。multica の方が created_at 古いが provider ゲートで
--      multica は除外 → 権威=A（google_tasks）。ゲートが created_at 順序に勝つことを検証。
insert into tasks (id, title, due_date) values
  ('c0000000-0000-4000-a000-000000000001','t1 ext-single','2026-08-01'),
  ('c0000000-0000-4000-a000-000000000002','t2 ext-multi','2026-08-01'),
  ('c0000000-0000-4000-a000-000000000003','t3 int-only','2026-08-01'),
  ('c0000000-0000-4000-a000-000000000004','t4 taskapp','2026-08-01'),
  ('c0000000-0000-4000-a000-000000000005','t5 multica-only',null),
  ('c0000000-0000-4000-a000-000000000006','t6 gtasks+multica','2026-08-01');
insert into connector_task_links (connection_id, task_id, external_id, origin, created_at) values
  ('a0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000001','ext-t1','external','2026-07-01'),
  ('b0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000002','ext-t2-old','external','2026-06-01'),
  ('a0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000002','ext-t2-new','external','2026-07-15'),
  ('a0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000003','int-t3','internal','2026-07-01'),
  ('90000000-0000-4000-a000-000000000009','c0000000-0000-4000-a000-000000000005','mca-t5','external','2026-07-01'),
  ('90000000-0000-4000-a000-000000000009','c0000000-0000-4000-a000-000000000006','mca-t6','external','2026-05-01'),
  ('a0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000006','ext-t6','external','2026-07-20');
SQL

echo "== apply migration verbatim (-1: single transaction) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260721133427_due_reminder_pr0.sql"

echo "== (B) backfill assertions =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare a text;
begin
  select due_authority_connection_id::text into a from tasks where id='c0000000-0000-4000-a000-000000000001';
  if a is distinct from 'a0000000-0000-4000-a000-000000000001' then raise exception 'FAIL B1: t1 authority=% (expected A)', a; end if;
  select due_authority_connection_id::text into a from tasks where id='c0000000-0000-4000-a000-000000000002';
  if a is distinct from 'b0000000-0000-4000-a000-000000000002' then raise exception 'FAIL B2: t2 authority=% (expected B=oldest)', a; end if;
  if (select due_authority_connection_id from tasks where id='c0000000-0000-4000-a000-000000000003') is not null
    then raise exception 'FAIL B3: t3(internal-only) should be NULL'; end if;
  if (select due_authority_connection_id from tasks where id='c0000000-0000-4000-a000-000000000004') is not null
    then raise exception 'FAIL B4: t4(no link) should be NULL'; end if;
  -- provider ゲート回帰: multica-only は権威 NULL（due 後付け可能であるべき）
  if (select due_authority_connection_id from tasks where id='c0000000-0000-4000-a000-000000000005') is not null
    then raise exception 'FAIL B5: t5(multica-only external) should be NULL (provider gate)'; end if;
  -- gtasks+multica: multica の方が古いが provider ゲートで gtasks(A) が権威に決まる
  select due_authority_connection_id::text into a from tasks where id='c0000000-0000-4000-a000-000000000006';
  if a is distinct from 'a0000000-0000-4000-a000-000000000001'
    then raise exception 'FAIL B6: t6(gtasks+multica) authority=% (expected A=google_tasks, gate beats created_at)', a; end if;
  raise notice 'PASS B: backfill (single/multi-oldest/internal-only/none/multica-only-NULL/gtasks+multica-gate)';
end $$;
SQL

echo "== (A) guard trigger assertions =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
-- (A-a) service_role → external権威タスクの due_date 変更成功
do $$
begin
  perform set_config('request.jwt.claim.role','service_role', true);
  update tasks set due_date='2026-09-01' where id='c0000000-0000-4000-a000-000000000001';
  if (select due_date from tasks where id='c0000000-0000-4000-a000-000000000001') <> '2026-09-01'
    then raise exception 'FAIL A-a: service_role due update not applied'; end if;
  raise notice 'PASS A-a: service_role can edit external due';
end $$;

-- (A-b) authenticated → 拒否（due_managed_externally）
do $$
declare raised boolean := false;
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  begin
    update tasks set due_date='2026-10-01' where id='c0000000-0000-4000-a000-000000000001';
  exception when others then
    if sqlerrm like '%due_managed_externally%' then raised := true; else raise; end if;
  end;
  if not raised then raise exception 'FAIL A-b: external due edit NOT blocked for authenticated'; end if;
  raise notice 'PASS A-b: authenticated blocked with due_managed_externally';
end $$;

-- (A-c) authenticated → title のみ変更は成功（WHEN 節が due 未変更を素通し）
do $$
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  update tasks set title='t1 renamed' where id='c0000000-0000-4000-a000-000000000001';
  if (select title from tasks where id='c0000000-0000-4000-a000-000000000001') <> 't1 renamed'
    then raise exception 'FAIL A-c: title-only update blocked (WHEN clause too broad)'; end if;
  raise notice 'PASS A-c: title-only update allowed (WHEN regression)';
end $$;

-- (A-d) 権威 NULL(TaskApp発 t4) → authenticated でも due 編集可
do $$
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  update tasks set due_date='2026-11-01' where id='c0000000-0000-4000-a000-000000000004';
  if (select due_date from tasks where id='c0000000-0000-4000-a000-000000000004') <> '2026-11-01'
    then raise exception 'FAIL A-d: TaskApp-origin due edit blocked'; end if;
  raise notice 'PASS A-d: authority NULL is editable';
end $$;

-- (A-f) multica-only タスク(t5・権威NULL) → authenticated で due_date 後付け可（トリガー不発火）
do $$
begin
  perform set_config('request.jwt.claim.role','authenticated', true);
  update tasks set due_date='2026-08-15' where id='c0000000-0000-4000-a000-000000000005';
  if (select due_date from tasks where id='c0000000-0000-4000-a000-000000000005') <> '2026-08-15'
    then raise exception 'FAIL A-f: multica-only due edit blocked (should be editable)'; end if;
  raise notice 'PASS A-f: multica-only task due editable by authenticated';
end $$;

-- (A-e) 接続 delete → 権威列 NULL 化（ON DELETE SET NULL）→ 以後 authenticated で編集可
do $$
begin
  delete from integration_connections where id='a0000000-0000-4000-a000-000000000001';
  if (select due_authority_connection_id from tasks where id='c0000000-0000-4000-a000-000000000001') is not null
    then raise exception 'FAIL A-e: authority not NULLed on connection delete'; end if;
  perform set_config('request.jwt.claim.role','authenticated', true);
  update tasks set due_date='2026-12-01' where id='c0000000-0000-4000-a000-000000000001';
  if (select due_date from tasks where id='c0000000-0000-4000-a000-000000000001') <> '2026-12-01'
    then raise exception 'FAIL A-e: due edit not restored after connection delete'; end if;
  raise notice 'PASS A-e: connection delete NULLs authority and restores editability';
end $$;
SQL

echo "== (D) _enqueue_connector_job fold assertions =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare n int; v bigint; p jsonb;
begin
  perform public._enqueue_connector_job('b0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000002','complete','{"a":1}'::jsonb);
  perform public._enqueue_connector_job('b0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000002','complete','{"b":2}'::jsonb);
  select count(*) into n from connector_jobs
    where connection_id='b0000000-0000-4000-a000-000000000002' and task_id='c0000000-0000-4000-a000-000000000002' and status='pending';
  if n <> 1 then raise exception 'FAIL D: pending rows=% (expected 1 folded)', n; end if;
  select version, payload into v, p from connector_jobs
    where connection_id='b0000000-0000-4000-a000-000000000002' and task_id='c0000000-0000-4000-a000-000000000002' and status='pending';
  if v <> 2 then raise exception 'FAIL D: version=% (expected 2)', v; end if;
  if p <> '{"b":2}'::jsonb then raise exception 'FAIL D: payload=% (expected latest {"b":2})', p; end if;
  raise notice 'PASS D: enqueue folds pending to 1 with version+1 and latest payload';
end $$;
SQL

echo "== (C) occurrences seed + claim/finalize (single-session) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
-- occurrence を2件 seed（scheduled_at 到来済み）＋ lease失効の1件。
insert into task_due_reminder_occurrences (id, task_id, kind, offset_minutes, due_snapshot, scheduled_at, status, leased_until, attempt)
values
  ('d0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000004','overdue_confirm', 60,'2026-08-01', now()-interval '5 min','pending', null, 0),
  ('d0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000004','due_today',        0,'2026-08-01', now()-interval '4 min','pending', null, 0),
  -- lease失効(leased かつ leased_until 過去)→ 再claim対象
  ('d0000000-0000-4000-a000-000000000003','c0000000-0000-4000-a000-000000000004','due_soon',      -1440,'2026-08-01', now()-interval '3 min','leased', now()-interval '1 min', 1);

-- claim: 3件すべて（pending2 + lease失効1）が返り、leased＋attempt+1 になる
do $$
declare cnt int; a3 int;
begin
  select count(*) into cnt from public.rpc_claim_due_reminder_occurrences(10, now());
  if cnt <> 3 then raise exception 'FAIL C-claim: claimed=% (expected 3 incl lease-expired)', cnt; end if;
  if (select count(*) from task_due_reminder_occurrences where status='leased') <> 3
    then raise exception 'FAIL C-claim: not all leased'; end if;
  select attempt into a3 from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003';
  if a3 <> 2 then raise exception 'FAIL C-claim: lease-expired attempt=% (expected 2)', a3; end if;
  raise notice 'PASS C-claim: pending+lease-expired claimed, leased, attempt+1';
end $$;

-- finalize sent
do $$
begin
  perform public.rpc_finalize_due_reminder_occurrence('d0000000-0000-4000-a000-000000000001','sent', null);
  if (select status from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000001') <> 'sent'
    then raise exception 'FAIL C-sent: status not sent'; end if;
  if (select sent_at from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000001') is null
    then raise exception 'FAIL C-sent: sent_at null'; end if;
  raise notice 'PASS C-sent';
end $$;

-- finalize suppressed
do $$
begin
  perform public.rpc_finalize_due_reminder_occurrence('d0000000-0000-4000-a000-000000000002','suppressed','stale_due');
  if (select status from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000002') <> 'suppressed'
    then raise exception 'FAIL C-suppressed: status'; end if;
  if (select suppress_reason from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000002') <> 'stale_due'
    then raise exception 'FAIL C-suppressed: reason'; end if;
  raise notice 'PASS C-suppressed';
end $$;

-- finalize deferred(予算差戻し)→ pending へ戻り scheduled_at が未来に前進
do $$
declare st text; sa timestamptz;
begin
  perform public.rpc_finalize_due_reminder_occurrence('d0000000-0000-4000-a000-000000000003','deferred','budget');
  select status, scheduled_at into st, sa from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003';
  if st <> 'pending' then raise exception 'FAIL C-deferred: status=% (expected pending)', st; end if;
  if sa <= now() then raise exception 'FAIL C-deferred: scheduled_at not advanced'; end if;
  raise notice 'PASS C-deferred: pending + scheduled_at advanced';
end $$;

-- finalize deferred 上限 → canceled（attempt を上限以上に上げて確認）
do $$
declare st text;
begin
  update task_due_reminder_occurrences set attempt=10 where id='d0000000-0000-4000-a000-000000000003';
  perform public.rpc_finalize_due_reminder_occurrence('d0000000-0000-4000-a000-000000000003','deferred','budget');
  select status into st from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003';
  if st <> 'canceled' then raise exception 'FAIL C-defer-cap: status=% (expected canceled)', st; end if;
  raise notice 'PASS C-defer-cap: deferred at attempt cap -> canceled';
end $$;

-- 二重finalize不変: canceled に sent を投げても遷移しない
do $$
begin
  perform public.rpc_finalize_due_reminder_occurrence('d0000000-0000-4000-a000-000000000003','sent', null);
  if (select status from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 'canceled'
    then raise exception 'FAIL C-terminal: terminal status mutated'; end if;
  raise notice 'PASS C-terminal: terminal status immutable';
end $$;
SQL

echo "== (C-skiplocked) 2セッション並行 claim: 二重取得なし =="
# 新規 pending を2件 seed。セッションA が最古1件を FOR UPDATE で保持したまま(pg_sleep)、
# セッションB の claim(10) が「ロック行を skip して残り1件だけ」を取得することを検証する。
psql "$CONN" -v ON_ERROR_STOP=1 -q -c "
insert into task_due_reminder_occurrences (id, task_id, kind, offset_minutes, due_snapshot, scheduled_at, status)
values
  ('e0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000004','due_today',0,'2026-08-02', now()-interval '2 min','pending'),
  ('e0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000004','due_today',0,'2026-08-03', now()-interval '1 min','pending');"

# セッションA: 最古(e...01)を行ロックしたまま3秒保持（backgroundで実行・pg_sleepで待機・bash sleep不使用）
psql "$CONN" -q -c "begin; select id from task_due_reminder_occurrences where status='pending' order by scheduled_at limit 1 for update; select pg_sleep(3); commit;" >/dev/null 2>&1 &
APID=$!

# セッションB: A がロックを取った後(server側 pg_sleep で1秒待つ)に claim。skip locked で残り1件のみ取得。
BCOUNT=$(psql "$CONN" -tAq -c "select pg_sleep(1); select count(*) from public.rpc_claim_due_reminder_occurrences(10, now());" | tail -n1 | tr -d '[:space:]')
wait "$APID" 2>/dev/null || true

if [ "$BCOUNT" != "1" ]; then
  echo "FAIL C-skiplocked: session B claimed '$BCOUNT' (expected 1; the locked row must be skipped)"; exit 1
fi
# A の行(e...01)は B に取られていない（B は e...02 を取得）ことを確認
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if (select status from task_due_reminder_occurrences where id='e0000000-0000-4000-a000-000000000001') <> 'pending'
    then raise exception 'FAIL C-skiplocked: locked row was claimed by B (double-acquire)'; end if;
  if (select status from task_due_reminder_occurrences where id='e0000000-0000-4000-a000-000000000002') <> 'leased'
    then raise exception 'FAIL C-skiplocked: unlocked row not claimed by B'; end if;
  raise notice 'PASS C-skiplocked: B skipped A''s locked row, claimed only the other';
end $$;
SQL

echo "== re-apply (idempotency) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260721133427_due_reminder_pr0.sql"
psql "$CONN" -v ON_ERROR_STOP=1 -q -c "select case when count(*)=1 then 'IDEMPOTENT OK' else 'FAIL: duplicate column' end from information_schema.columns where table_name='tasks' and column_name='due_authority_connection_id';"

echo "== ALL DONE =="
