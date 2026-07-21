#!/usr/bin/env bash
# =============================================================================
# 期限リマインド PR-2 完了確認ループ migration 検証ハーネス（throwaway クラスタ）
#
# 20260721162336_due_reminder_confirm_loop.sql の境界を throwaway PG クラスタで検証する。
#   (Confirm) 正当link→'done'＋active な connector_task_link ごとに complete job ちょうど1件 /
#             2連打→2回目 'already_done'＋complete job 増えない / 並行2セッション→single-winner /
#             revoked link・他org口座・非メンバー→'forbidden' / gtasks+multica 両linkで各接続1件 /
#             client(space member)→'done'（space_memberships 経路）。
#   (Gate・正本整合 #3) considering spec→'blocked' / decided spec→'done' / implemented spec→'done' /
#             open review→'blocked' / cancelled review→'done'。
#   (可視性 #1 HIGH) client が client_scope='internal' タスク→'forbidden'（confirm/snooze・遷移0） /
#             vendor が deliverable かつ client-ball タスク→'forbidden' / internal は全件可視で 'done'。
#   (Snooze #2) 正当(世代一致)→'snoozed'＋前進＋send_count+1 / 古世代→'already_snoozed' no-op /
#             2連打→2回目 already_snoozed / 上限→'capped'＋canceled / days=9999→30クランプ＋
#             過去 scheduled_at→now() 基準クランプ（即再送しない） / occurrence 無→'not_found' /
#             他org口座→'forbidden'。
#   grant: anon/authenticated 実行不可・service_role のみ。冪等: 再適用 OK。
#
# 使い捨てクラスタを起動し終了時に破棄。本番DBには触れない。
# 使い方: bash supabase/tests/run_due_reminder_confirm.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/drc.XXXXXX)"
PGDATA="$WORK/data"
SOCK="$WORK/s"
PORT=54421
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

echo "== bootstrap: roles + 依存テーブル/関数/トリガー + テストデータ =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- 依存テーブル（migration が触る列＋test が要する列だけの最小構成。実チェーンでは先行 migration が作る）。
create table organizations (id uuid primary key);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, space_id uuid not null, title text not null default '',
  status text not null default 'todo',
  type text not null default 'task' check (type in ('task','spec')),
  decision_state text,
  -- 可視性判定に必要な列（20260101000000_baseline_client_scope.sql / ball）
  client_scope text not null default 'deliverable' check (client_scope in ('deliverable','internal')),
  ball text not null default 'internal' check (ball in ('client','internal')),
  due_date date, completed_at timestamptz,
  updated_at timestamptz not null default now()
);
-- 完了 completed_at 自動トリガー（20260223_000_completed_at_tracking.sql の該当部を再現）。
create or replace function trg_task_completed_at() returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then new.completed_at := now(); end if;
  if old.status = 'done' and new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger trg_task_completed_at before update on tasks for each row execute function trg_task_completed_at();

create table org_memberships (
  org_id uuid not null, user_id uuid not null,
  role text not null check (role in ('owner','admin','member','client')),
  unique (org_id, user_id)
);
create table space_memberships (
  space_id uuid not null, user_id uuid not null, role text not null,
  unique (space_id, user_id)
);
create table channel_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, user_id uuid not null,
  channel_account_id uuid not null, external_user_id text not null,
  revoked_at timestamptz
);
create table reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null, status text not null default 'open',
  unique (task_id)
);
create table connector_task_links (
  connection_id uuid not null, task_id uuid not null,
  external_id text not null, origin text not null default 'external',
  state text not null default 'active' check (state in ('active','orphaned')),
  primary key (connection_id, task_id)
);
create table connector_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null, task_id uuid not null,
  op text not null, payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending', attempt int not null default 0,
  next_attempt_at timestamptz not null default now(), version bigint not null default 1,
  leased_until timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index connector_jobs_pending_unique
  on connector_jobs (connection_id, task_id) where status = 'pending';
create table task_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, space_id uuid not null, task_id uuid not null,
  actor_id uuid not null, action text not null, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- task_due_reminder_occurrences（20260721133427_due_reminder_pr0.sql の定義を再現）。
create table task_due_reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  kind text not null check (kind in ('due_soon','due_today','overdue_confirm')),
  offset_minutes int not null,
  due_snapshot date not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','leased','sent','suppressed','canceled')),
  leased_until timestamptz, attempt int not null default 0, send_count int not null default 0,
  sent_at timestamptz, suppress_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (task_id, due_snapshot, offset_minutes)
);
-- _enqueue_connector_job（PR-0 のヘルパを再現＝(connection,task) pending を最新1件に fold・version+1）。
create or replace function public._enqueue_connector_job(
  p_connection uuid, p_task uuid, p_op text, p_payload jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.connector_jobs (connection_id, task_id, op, payload, status, next_attempt_at)
  values (p_connection, p_task, p_op, p_payload, 'pending', now())
  on conflict (connection_id, task_id) where status = 'pending'
  do update set op = excluded.op, payload = excluded.payload,
                attempt = 0, next_attempt_at = now(), last_error = null,
                version = public.connector_jobs.version + 1, updated_at = now();
$$;

-- ---- テストデータ ---------------------------------------------------------
-- org O1 / O2、space S1(O1)
insert into organizations (id) values
  ('11111111-0000-4000-a000-000000000001'),
  ('22222222-0000-4000-a000-000000000002');

-- users
--  U_member    aaaa : O1 member（内部・全件可視）
--  U_client    bbbb : O1 client + space S1 member（client role・deliverable のみ可視）
--  U_nonmember cccc : O1 に link はあるが org_memberships 無し → forbidden
--  U_other     dddd : O2 member（他org口座テスト）
--  U_vendor    eeee : O1 client + space S1 vendor（deliverable かつ非client-ball のみ可視）
insert into org_memberships (org_id, user_id, role) values
  ('11111111-0000-4000-a000-000000000001','aaaaaaaa-0000-4000-a000-000000000001','member'),
  ('11111111-0000-4000-a000-000000000001','bbbbbbbb-0000-4000-a000-000000000001','client'),
  ('22222222-0000-4000-a000-000000000002','dddddddd-0000-4000-a000-000000000001','member'),
  ('11111111-0000-4000-a000-000000000001','eeeeeeee-0000-4000-a000-000000000001','client');
insert into space_memberships (space_id, user_id, role) values
  ('55555555-0000-4000-a000-000000000001','bbbbbbbb-0000-4000-a000-000000000001','client'),
  ('55555555-0000-4000-a000-000000000001','eeeeeeee-0000-4000-a000-000000000001','vendor');

-- channel accounts: acc1(O1) / acc2(O2)
insert into channel_user_links (org_id, user_id, channel_account_id, external_user_id, revoked_at) values
  ('11111111-0000-4000-a000-000000000001','aaaaaaaa-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','u-member',null),
  ('11111111-0000-4000-a000-000000000001','aaaaaaaa-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','u-revoked',now()),
  ('11111111-0000-4000-a000-000000000001','bbbbbbbb-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','u-client',null),
  ('11111111-0000-4000-a000-000000000001','cccccccc-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','u-nomem',null),
  ('11111111-0000-4000-a000-000000000001','eeeeeeee-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','u-vendor',null),
  ('22222222-0000-4000-a000-000000000002','dddddddd-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a2','u-member',null);

-- tasks（すべて org O1 / space S1）
--  c01 T_multi           : task todo deliverable・gtasks(cnA)+multica(cnB) の2 active link（+orphaned）
--  c02 T_spec_considering: spec considering → blocked
--  c03 T_spec_impl       : spec implemented → done
--  c04 T_review_open     : task + open review → blocked
--  c05 T_snz             : task・snooze occurrence の親
--  c06 T_spec_decided    : spec decided → done（正本整合: decided は完了可）
--  c07 T_review_cancelled: task + cancelled review → done（正本整合: cancelled は妨げない）
--  c08 T_invisible       : client_scope='internal'（client/vendor 不可視・internal 可視）
--  c09 T_forbid          : task deliverable（forbidden 系テストの的・遷移させない）
--  c10 T_client_done     : task deliverable（client の space_memberships 経路 done）
--  c11 T_vendor_cliball  : deliverable かつ ball='client'（vendor 不可視）
insert into tasks (id, org_id, space_id, title, status, type, decision_state, client_scope, ball) values
  ('c0000000-0000-4000-a000-000000000001','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_multi','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000002','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_spec_considering','todo','spec','considering','deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000003','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_spec_impl','todo','spec','implemented','deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000004','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_review_open','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000005','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_snz','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000006','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_spec_decided','todo','spec','decided','deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000007','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_review_cancelled','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000008','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_invisible','todo','task',null,'internal','internal'),
  ('c0000000-0000-4000-a000-000000000009','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_forbid','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000010','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_client_done','todo','task',null,'deliverable','internal'),
  ('c0000000-0000-4000-a000-000000000011','11111111-0000-4000-a000-000000000001','55555555-0000-4000-a000-000000000001','T_vendor_cliball','todo','task',null,'deliverable','client');

-- T_multi の2 active link（cnA=gtasks / cnB=multica）＋ orphaned（enqueue 対象外）
insert into connector_task_links (connection_id, task_id, external_id, origin, state) values
  ('e0000000-0000-4000-a000-0000000000a1','c0000000-0000-4000-a000-000000000001','gt-1','external','active'),
  ('e0000000-0000-4000-a000-0000000000b1','c0000000-0000-4000-a000-000000000001','mc-1','external','active'),
  ('e0000000-0000-4000-a000-0000000000c1','c0000000-0000-4000-a000-000000000001','or-1','external','orphaned');

-- reviews: open / cancelled
insert into reviews (task_id, status) values
  ('c0000000-0000-4000-a000-000000000004','open'),
  ('c0000000-0000-4000-a000-000000000007','cancelled');

-- snooze occurrences
--  d01 T_snz  sc=0 sent 未来sched      → Snooze-1 valid(expected=0)
--  d02 T_snz  sc=3 sent                → capped(expected=3)
--  d03 T_snz  sc=1 sent                → 世代ガード（old/valid/double）
--  d04 T_snz  sc=0 sent 過去sched      → days=9999→30 & base=now() クランプ
--  d05 T_invisible sc=0 sent           → 可視性 forbidden（U_client）
insert into task_due_reminder_occurrences (id, task_id, kind, offset_minutes, due_snapshot, scheduled_at, status, send_count) values
  ('d0000000-0000-4000-a000-000000000001','c0000000-0000-4000-a000-000000000005','overdue_confirm',60,'2026-08-01','2026-08-01 09:00:00+00','sent',0),
  ('d0000000-0000-4000-a000-000000000002','c0000000-0000-4000-a000-000000000005','overdue_confirm',60,'2026-08-02','2026-08-02 09:00:00+00','sent',3),
  ('d0000000-0000-4000-a000-000000000003','c0000000-0000-4000-a000-000000000005','overdue_confirm',60,'2026-08-03','2026-08-03 09:00:00+00','sent',1),
  ('d0000000-0000-4000-a000-000000000004','c0000000-0000-4000-a000-000000000005','overdue_confirm',60,'2026-08-04','2026-01-01 09:00:00+00','sent',0),
  ('d0000000-0000-4000-a000-000000000005','c0000000-0000-4000-a000-000000000008','overdue_confirm',60,'2026-08-05','2026-08-05 09:00:00+00','sent',0);
SQL

echo "== apply migration verbatim (-1: single transaction) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260721162336_due_reminder_confirm_loop.sql"

ACC1="a0000000-0000-4000-a000-0000000000a1"
ACC2="a0000000-0000-4000-a000-0000000000a2"
T_MULTI="c0000000-0000-4000-a000-000000000001"
CN_A="e0000000-0000-4000-a000-0000000000a1"
CN_B="e0000000-0000-4000-a000-0000000000b1"

echo "== (Confirm-1) 正当link→'done' ＋ active link ごとに complete job ちょうど1件 =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text; nA int; nB int; nJobs int; nEv int;
begin
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','$T_MULTI');
  if st <> 'done' then raise exception 'FAIL Confirm-1: status=% (expected done)', st; end if;
  if (select status from tasks where id='$T_MULTI') <> 'done' then raise exception 'FAIL Confirm-1: task not done'; end if;
  if (select completed_at from tasks where id='$T_MULTI') is null then raise exception 'FAIL Confirm-1: completed_at not set by trigger'; end if;
  select count(*) into nA from connector_jobs where connection_id='$CN_A' and task_id='$T_MULTI' and op='complete' and status='pending';
  select count(*) into nB from connector_jobs where connection_id='$CN_B' and task_id='$T_MULTI' and op='complete' and status='pending';
  if nA <> 1 then raise exception 'FAIL Confirm-1: gtasks complete jobs=% (expected 1)', nA; end if;
  if nB <> 1 then raise exception 'FAIL Confirm-1: multica complete jobs=% (expected 1)', nB; end if;
  select count(*) into nJobs from connector_jobs where task_id='$T_MULTI' and op='complete';
  if nJobs <> 2 then raise exception 'FAIL Confirm-1: total complete jobs=% (expected 2=only active links)', nJobs; end if;
  select count(*) into nEv from task_events where task_id='$T_MULTI' and action='task.completed_via_line';
  if nEv <> 1 then raise exception 'FAIL Confirm-1: task_events=% (expected 1)', nEv; end if;
  raise notice 'PASS Confirm-1: done + 1 complete job per active link (gtasks+multica) + audit';
end \$\$;
SQL

echo "== (Confirm-2) 2連打→2回目 'already_done'・complete job 増えない =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text; nJobs int; nEv int;
begin
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','$T_MULTI');
  if st <> 'already_done' then raise exception 'FAIL Confirm-2: status=% (expected already_done)', st; end if;
  select count(*) into nJobs from connector_jobs where task_id='$T_MULTI' and op='complete';
  if nJobs <> 2 then raise exception 'FAIL Confirm-2: complete jobs=% (expected still 2)', nJobs; end if;
  select count(*) into nEv from task_events where task_id='$T_MULTI' and action='task.completed_via_line';
  if nEv <> 1 then raise exception 'FAIL Confirm-2: task_events=% (expected still 1)', nEv; end if;
  raise notice 'PASS Confirm-2: second tap already_done, no extra enqueue/audit';
end \$\$;
SQL

echo "== (Confirm-3) revoked / 他org口座 / 非メンバー → 'forbidden'（遷移0） =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text;
begin
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-revoked','c0000000-0000-4000-a000-000000000009');
  if st <> 'forbidden' then raise exception 'FAIL Confirm-3a: revoked link status=% (expected forbidden)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC2','u-member','c0000000-0000-4000-a000-000000000009');
  if st <> 'forbidden' then raise exception 'FAIL Confirm-3b: cross-org account status=% (expected forbidden)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-nomem','c0000000-0000-4000-a000-000000000009');
  if st <> 'forbidden' then raise exception 'FAIL Confirm-3c: non-member status=% (expected forbidden)', st; end if;
  if (select status from tasks where id='c0000000-0000-4000-a000-000000000009') = 'done' then raise exception 'FAIL Confirm-3: task done despite forbidden'; end if;
  raise notice 'PASS Confirm-3: revoked/cross-org/non-member all forbidden, no transition';
end \$\$;
SQL

echo "== (Gate #3) considering→blocked / decided→done / implemented→done / open review→blocked / cancelled review→done =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text;
begin
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000002');
  if st <> 'blocked' then raise exception 'FAIL Gate-a: considering spec status=% (expected blocked)', st; end if;
  if (select status from tasks where id='c0000000-0000-4000-a000-000000000002') = 'done' then raise exception 'FAIL Gate-a: transitioned'; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000006');
  if st <> 'done' then raise exception 'FAIL Gate-b: decided spec status=% (expected done)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000003');
  if st <> 'done' then raise exception 'FAIL Gate-c: implemented spec status=% (expected done)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000004');
  if st <> 'blocked' then raise exception 'FAIL Gate-d: open review status=% (expected blocked)', st; end if;
  if (select status from tasks where id='c0000000-0000-4000-a000-000000000004') = 'done' then raise exception 'FAIL Gate-d: transitioned'; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000007');
  if st <> 'done' then raise exception 'FAIL Gate-e: cancelled review status=% (expected done)', st; end if;
  raise notice 'PASS Gate #3: considering blocked, decided/implemented done, open blocked, cancelled done';
end \$\$;
SQL

echo "== (Vis #1) client→internal-scope forbidden / vendor→client-ball forbidden / internal 可視 done / client space経路 done =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text;
begin
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-client','c0000000-0000-4000-a000-000000000008');
  if st <> 'forbidden' then raise exception 'FAIL Vis-a: client on internal-scope status=% (expected forbidden)', st; end if;
  if (select status from tasks where id='c0000000-0000-4000-a000-000000000008') = 'done' then raise exception 'FAIL Vis-a: transitioned'; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-vendor','c0000000-0000-4000-a000-000000000011');
  if st <> 'forbidden' then raise exception 'FAIL Vis-b: vendor on client-ball status=% (expected forbidden)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-member','c0000000-0000-4000-a000-000000000008');
  if st <> 'done' then raise exception 'FAIL Vis-c: internal on internal-scope status=% (expected done)', st; end if;
  select status into st from public.rpc_confirm_task_done_via_line('$ACC1','u-client','c0000000-0000-4000-a000-000000000010');
  if st <> 'done' then raise exception 'FAIL Vis-d: client on deliverable status=% (expected done)', st; end if;
  raise notice 'PASS Vis #1: client/vendor invisible forbidden, internal all-visible done, client deliverable done';
end \$\$;
SQL

echo "== (Confirm-6) 並行2セッション → single-winner（task done ＋ 接続ごと job 1件のまま） =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -c "
  update tasks set status='todo', completed_at=null where id='$T_MULTI';
  delete from connector_jobs where task_id='$T_MULTI';
  delete from task_events where task_id='$T_MULTI';"
psql "$CONN" -q -c "select status from public.rpc_confirm_task_done_via_line('$ACC1','u-member','$T_MULTI');" >/dev/null 2>&1 &
P1=$!
psql "$CONN" -q -c "select status from public.rpc_confirm_task_done_via_line('$ACC1','u-member','$T_MULTI');" >/dev/null 2>&1 &
P2=$!
wait "$P1" 2>/dev/null || true
wait "$P2" 2>/dev/null || true
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare nA int; nB int; nEv int;
begin
  if (select status from tasks where id='$T_MULTI') <> 'done' then raise exception 'FAIL Confirm-6: task not done'; end if;
  select count(*) into nA from connector_jobs where connection_id='$CN_A' and task_id='$T_MULTI' and op='complete' and status='pending';
  select count(*) into nB from connector_jobs where connection_id='$CN_B' and task_id='$T_MULTI' and op='complete' and status='pending';
  if nA <> 1 or nB <> 1 then raise exception 'FAIL Confirm-6: complete jobs gtasks=% multica=% (expected 1/1 = single-winner enqueue)', nA, nB; end if;
  select count(*) into nEv from task_events where task_id='$T_MULTI' and action='task.completed_via_line';
  if nEv <> 1 then raise exception 'FAIL Confirm-6: task_events=% (expected 1, single-winner)', nEv; end if;
  raise notice 'PASS Confirm-6: single-winner (task done, 1 complete job per active link, 1 audit)';
end \$\$;
SQL

echo "== (Snooze-1) 正当(世代一致)→'snoozed'＋scheduled_at 前進＋send_count+1 =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text; sa timestamptz; sc int; sn text;
begin
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000001',3,0);
  if st <> 'snoozed' then raise exception 'FAIL Snooze-1: status=% (expected snoozed)', st; end if;
  select scheduled_at, send_count, status into sa, sc, sn from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000001';
  -- 未来 scheduled_at(2026-08-01)基準 +3日
  if sa <> '2026-08-04 09:00:00+00'::timestamptz then raise exception 'FAIL Snooze-1: scheduled_at=% (expected +3 days)', sa; end if;
  if sc <> 1 then raise exception 'FAIL Snooze-1: send_count=% (expected 1)', sc; end if;
  if sn <> 'pending' then raise exception 'FAIL Snooze-1: status=% (expected pending)', sn; end if;
  raise notice 'PASS Snooze-1: snoozed, scheduled_at +3d, send_count=1, pending';
end \$\$;
SQL

echo "== (Snooze-2) 世代ガード: 古世代→already_snoozed / 配信済み正当→snoozed / 2連打→already_snoozed / 未再配信(pending)へ手動世代前進→効かない =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text; sa0 timestamptz; sa1 timestamptz;
begin
  -- d03 は status='sent'・現 send_count=1。古世代 expected=0 → already_snoozed（no-op）
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000003',2,0);
  if st <> 'already_snoozed' then raise exception 'FAIL Snooze-2a: old-gen status=% (expected already_snoozed)', st; end if;
  if (select send_count from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 1
    then raise exception 'FAIL Snooze-2a: send_count mutated on no-op'; end if;
  -- 配信済み(sent)＋正当 expected=1 → snoozed, send_count→2, status→pending(再アーム)
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000003',2,1);
  if st <> 'snoozed' then raise exception 'FAIL Snooze-2b: valid status=% (expected snoozed)', st; end if;
  if (select send_count from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 2
    then raise exception 'FAIL Snooze-2b: send_count not incremented'; end if;
  if (select status from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 'pending'
    then raise exception 'FAIL Snooze-2b: occurrence not re-armed to pending'; end if;
  -- 同一呼び 2連打（expected=1 を再送）→ 現 send_count=2 と不一致 → already_snoozed
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000003',2,1);
  if st <> 'already_snoozed' then raise exception 'FAIL Snooze-2c: double-tap status=% (expected already_snoozed)', st; end if;
  if (select send_count from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 2
    then raise exception 'FAIL Snooze-2c: send_count mutated on replay'; end if;
  -- ★ Finding B: 直前スヌーズで status='pending'(未再配信)・send_count=2。手動で世代を合わせて
  --   （expected=2＝現 send_count 一致）連投しても status<>'sent' なので効かない＝手動世代前進不能。
  select scheduled_at into sa0 from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003';
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000003',30,2);
  if st <> 'already_snoozed' then raise exception 'FAIL Snooze-2d: pending manual-advance status=% (expected already_snoozed)', st; end if;
  select scheduled_at into sa1 from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003';
  if (select send_count from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000003') <> 2
    then raise exception 'FAIL Snooze-2d: send_count advanced on pending (manual gen advance leaked)'; end if;
  if sa1 is distinct from sa0 then raise exception 'FAIL Snooze-2d: scheduled_at advanced on pending (manual mute leaked)'; end if;
  raise notice 'PASS Snooze-2: gen guard (old-gen/valid+re-arm/double-tap) + pending manual-advance blocked (Finding B)';
end \$\$;
SQL

echo "== (Snooze-3) days=9999→30クランプ ＋ 過去 scheduled_at→now() 基準クランプ（即再送しない） =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text; sa timestamptz;
begin
  -- d04: send_count=0, scheduled_at=2026-01-01(過去・>24h). days=9999 要求。
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000004',9999,0);
  if st <> 'snoozed' then raise exception 'FAIL Snooze-3: status=% (expected snoozed)', st; end if;
  select scheduled_at into sa from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000004';
  -- 基準=now()（過去 scheduled_at は now() にクランプ）＋days=30（9999→30）→ 約 now()+30d。
  --   即再送しない（過去でない）ことと、9999日でなく30日であることを同時に検証。
  if sa <= now() then raise exception 'FAIL Snooze-3: scheduled_at=% not in future (base clamp failed→immediate resend)', sa; end if;
  if sa < now() + interval '29 days' or sa > now() + interval '31 days'
    then raise exception 'FAIL Snooze-3: scheduled_at=% not ~now()+30d (days clamp or base clamp wrong)', sa; end if;
  raise notice 'PASS Snooze-3: days clamped to 30 and base clamped to now() (no immediate resend)';
end \$\$;
SQL

echo "== (Snooze-4) 上限→'capped'＋canceled / occurrence 無→'not_found' / 他org口座→'forbidden' / 可視性→'forbidden' =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare st text;
begin
  -- d02: send_count=3(上限), expected=3 → capped＋canceled
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-000000000002',3,3);
  if st <> 'capped' then raise exception 'FAIL Snooze-4a: status=% (expected capped)', st; end if;
  if (select status from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000002') <> 'canceled'
    then raise exception 'FAIL Snooze-4a: occurrence not canceled'; end if;
  -- occurrence 無
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-member','d0000000-0000-4000-a000-0000000000ff',3,0);
  if st <> 'not_found' then raise exception 'FAIL Snooze-4b: status=% (expected not_found)', st; end if;
  -- 他org口座（acc2/O2）で O1 occurrence → forbidden
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC2','u-member','d0000000-0000-4000-a000-000000000001',3,1);
  if st <> 'forbidden' then raise exception 'FAIL Snooze-4c: cross-org status=% (expected forbidden)', st; end if;
  -- 可視性: client(bbbb) が不可視 internal-scope タスク(c08)の occurrence(d05) → forbidden・遷移0
  select status into st from public.rpc_snooze_due_reminder_via_line('$ACC1','u-client','d0000000-0000-4000-a000-000000000005',3,0);
  if st <> 'forbidden' then raise exception 'FAIL Snooze-4d: visibility status=% (expected forbidden)', st; end if;
  if (select send_count from task_due_reminder_occurrences where id='d0000000-0000-4000-a000-000000000005') <> 0
    then raise exception 'FAIL Snooze-4d: occurrence mutated despite forbidden'; end if;
  raise notice 'PASS Snooze-4: capped+canceled, not_found, cross-org forbidden, visibility forbidden';
end \$\$;
SQL

echo "== (grant) anon/authenticated から EXECUTE 不可（service_role のみ） =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
begin
  if has_function_privilege('anon','public.rpc_confirm_task_done_via_line(uuid, text, uuid)','execute')
    then raise exception 'FAIL grant: anon can execute confirm rpc'; end if;
  if has_function_privilege('authenticated','public.rpc_snooze_due_reminder_via_line(uuid, text, uuid, int, int)','execute')
    then raise exception 'FAIL grant: authenticated can execute snooze rpc'; end if;
  if has_function_privilege('authenticated','public.app_task_visible_to_actor(uuid, uuid)','execute')
    then raise exception 'FAIL grant: authenticated can execute visibility helper'; end if;
  if not has_function_privilege('service_role','public.rpc_confirm_task_done_via_line(uuid, text, uuid)','execute')
    then raise exception 'FAIL grant: service_role cannot execute confirm rpc'; end if;
  if not has_function_privilege('service_role','public.rpc_snooze_due_reminder_via_line(uuid, text, uuid, int, int)','execute')
    then raise exception 'FAIL grant: service_role cannot execute snooze rpc'; end if;
  raise notice 'PASS grant: service_role only';
end \$\$;
SQL

echo "== re-apply (idempotency) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260721162336_due_reminder_confirm_loop.sql"
psql "$CONN" -v ON_ERROR_STOP=1 -q -c "select case when count(*)=1 then 'IDEMPOTENT OK' else 'FAIL: snooze proc count '||count(*) end from pg_proc where proname='rpc_snooze_due_reminder_via_line';"

echo "== ALL DONE =="
