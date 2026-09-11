#!/usr/bin/env bash
# =============================================================================
# GitHub Issues 連携（PR1 の DB 部分）検証ハーネス
#
# 使い捨てクラスタで baseline スタブ → 実 migration を verbatim 適用 → 検証 → 破棄。
#   20240205_000 / 20240205_001            GitHub 連携の元定義（github_repositories・updated_at 関数など）
#   20260703_001 / 002 / 003 / 010         RLS ヘルパ・tasks・membership の本番 RLS
#                                          （新しい表のポリシーが中で読む tasks / membership も本番同様に絞る）
#   20260907142526                         二要素認証の RESTRICTIVE ポリシー（その時点の RLS 表に付く）
#   20260910212804 / 20260910233637        GitHub 表の社内限定 RLS・許可範囲の列
#   *_github_issues_link.sql               本 migration（2回適用して冪等も確認）
# の順に流し、github_issues_link_assert.sql で視点別の読み書き・組織一致トリガー・集計関数を検証する。
# 続けて GREEN のときだけ:
#   conc_*      2つの接続から同じタスクを同時に再計算しても「1以上→0」は1回だけ報告される
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  migration 末尾のロールバック節で、適用前のスキーマ（表・列・ポリシー・関数・トリガー・制約・権限）に戻る
#               → 戻したあと再適用できる
#
# 使い方:
#   bash supabase/tests/run_github_issues_link.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_github_issues_link.sh    # 本 migration を適用せずに流し、
#       assert が落ちる（= テストが「無い状態」を検出できる）ことを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/ghissues.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54441
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・ポリシー・関数・トリガー・制約・権限）。データは含まない
fingerprint(){
  psql "$CONN" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'rel ' || c.relname || ' ' || c.relkind || ' ' || coalesce(c.relacl::text, '') || ' rls=' || c.relrowsecurity::text as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'fn ' || p.oid::regprocedure::text || ' ' || p.prosecdef::text || ' ' || coalesce(p.proacl::text, '')
         || ' ' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

echo "== baseline + stubs =="
apply "$TST/harness/baseline_stubs.sql"
apply "$TST/harness/rls_github_setup.sql"
apply "$TST/harness/github_issues_link_setup.sql"

echo "== prior migrations (verbatim) =="
apply "$MIG/20240205_000_github_integration.sql"
apply "$MIG/20240205_001_github_security_fixes.sql"
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260703_002_rls_tasks.sql"
apply "$MIG/20260703_003_rls_membership.sql"
apply "$MIG/20260703_010_rls_vendor_task_scope.sql"
apply "$MIG/20260907142526_mfa_rls_enforcement.sql"
apply "$MIG/20260910212804_rls_github_internal_only.sql"
apply "$MIG/20260910233637_github_installation_permissions.sql"

TARGET=""
if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  shopt -s nullglob
  targets=("$MIG"/*_github_issues_link.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  TARGET="${targets[0]}"
  fingerprint > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply "$TARGET"
  apply "$TARGET"
fi

echo "== checks =="
OUT="$WORK/o.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 \
  -f "$TST/github_issues_link_assert.sql" > "$OUT" 2>&1
set -e
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# 書き込み assert が権限拒否・制約違反以外の SQL エラーで終わった = テストデータ／ハーネスの不備
if grep -q "got error:" "$OUT"; then
  echo "HARNESS ERROR: an assert hit an unexpected SQL error:"
  grep -oE "FAIL\[[a-z0-9_]+\]: got error:.*" "$OUT"; exit 1
fi

NEW_OBJ='github_issues|task_github_issue_links|task_github_issue_rollups|github_recompute_issue_rollup|check_task_issue_org_match'

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  NPASS="$(grep -c '^PASS\[' "$RES" || true)"
  NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  # 落ち方が「本 migration が無いこと」によるものか（ハーネス自体の不備ではないか）を確かめる
  ERRS="$(grep "ERROR" "$OUT" | grep -v "GITHUB ISSUES LINK CHECKS FAILED" || true)"
  if [ -n "$ERRS" ] && printf '%s\n' "$ERRS" | grep -qvE "$NEW_OBJ"; then
    echo "RED MISMATCH: failed for a reason unrelated to the missing migration:"; printf '%s\n' "$ERRS"; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: no assert failed without the migration"; exit 1
  fi
  echo "stopped at: ${ERRS:-<none>}"
  echo ""
  echo "RED CONFIRMED: $NFAIL assert(s) fail without the migration"
  exit 0
fi

# GREEN: 集計の例外以外の ERROR はハーネスか migration の不備
if grep "ERROR" "$OUT" | grep -qv "GITHUB ISSUES LINK CHECKS FAILED"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

echo "== concurrency: two sessions recompute the same task =="
O1='00000000-0000-0000-0000-0000000000a1'
S1='00000000-0000-0000-0000-0000000000b1'
R1='00000000-0000-0000-0000-0000000000e1'
TC='00000000-0000-0000-0000-0000000000dc'
ICX='00000000-0000-0000-0000-0000000010cc'
psql "$CONN" -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.tasks(id, org_id, space_id, title, ball, client_scope)
  values ('$TC', '$O1', '$S1', 'tc', 'internal', 'deliverable');
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state)
  values ('$ICX', '$O1', '$R1', 91, 'c', 'https://example.invalid/i/91', 'open');
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type)
  values ('$O1', '$TC', '$ICX', 'auto');
select * from public.github_recompute_issue_rollup('$TC');
update public.github_issues set state = 'closed', state_reason = 'completed' where id = '$ICX';
SQL
FMT="format('%s>%s:%s', open_count_before, open_count_after, became_all_closed::text)"
# A: 再計算してから 2 秒間コミットしない（その間、集計行のロックを持つ）
psql "$CONN" -qtA -v ON_ERROR_STOP=1 > "$WORK/conc_a.out" 2>&1 <<SQL &
begin;
select $FMT from public.github_recompute_issue_rollup('$TC');
select pg_sleep(2);
commit;
SQL
A_PID=$!
sleep 0.7
# B: A のコミットを待ってから、A の結果を「変更前」として読む（待たなければ 1>0 を二重に報告してしまう）
psql "$CONN" -qtA -v ON_ERROR_STOP=1 -c "select $FMT from public.github_recompute_issue_rollup('$TC')" \
  > "$WORK/conc_b.out" 2>&1
wait "$A_PID"
A_RES="$(grep -m1 -E '^[0-9]+>' "$WORK/conc_a.out" || true)"
B_RES="$(grep -m1 -E '^[0-9]+>' "$WORK/conc_b.out" || true)"
[ "$A_RES" = "1>0:true" ]  && record "PASS[conc_first_reports_transition]: $A_RES" || record "FAIL[conc_first_reports_transition]: got ${A_RES:-<none>}, want 1>0:true"
[ "$B_RES" = "0>0:false" ] && record "PASS[conc_second_waits_no_double]: $B_RES"  || record "FAIL[conc_second_waits_no_double]: got ${B_RES:-<none>}, want 0>0:false"

# ---- Issue の書き換えと再計算の RPC（github_apply_issue_state）と、紐づけトリガーの同時実行 ----
U_OWN='00000000-0000-0000-0000-0000000000c1'
K1='00000000-0000-0000-0000-00000000c001'; K2='00000000-0000-0000-0000-00000000c002'
K3='00000000-0000-0000-0000-00000000c003'
KA='00000000-0000-0000-0000-00000000c00a'; KB='00000000-0000-0000-0000-00000000c00b'
KC='00000000-0000-0000-0000-00000000c00c'; KD='00000000-0000-0000-0000-00000000c00d'
X1='00000000-0000-0000-0000-00000000d101'; Y1='00000000-0000-0000-0000-00000000d102'; Z1='00000000-0000-0000-0000-00000000d103'
X2='00000000-0000-0000-0000-00000000d111'; Y2='00000000-0000-0000-0000-00000000d112'; Z2='00000000-0000-0000-0000-00000000d113'
X3='00000000-0000-0000-0000-00000000d121'
IQ='00000000-0000-0000-0000-00000000d131'; IP='00000000-0000-0000-0000-00000000d141'; IR='00000000-0000-0000-0000-00000000d151'
ROWFMT="format('%s>%s:%s', open_count_before, open_count_after, became_all_closed::text)"

sqlq(){ psql "$CONN" -qtA -v ON_ERROR_STOP=1 "$@"; }
check_eq(){ if [ "$2" = "$3" ]; then record "PASS[$1]: $2"; else record "FAIL[$1]: got ${2:-<none>}, want $3"; fi; }
first_line(){ grep -m1 -E "$1" "$2" 2>/dev/null || true; }
apply_close(){ echo "public.github_apply_issue_state('$O1', '$R1', $1, 'title-$1', 'https://example.invalid/i/$1', 'closed', 'completed', null, '{}', null, now(), now())"; }
rollup_of(){ sqlq -c "select format('open=%s c=%s', open_count, completed_count) || '|' || coalesce(all_closed_at::text, '-') from public.task_github_issue_rollups where task_id = '$1'" 2>/dev/null || true; }

sqlq >/dev/null <<SQL
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  ('$K1','$O1','$S1','k1','internal','deliverable'), ('$K2','$O1','$S1','k2','internal','deliverable'),
  ('$K3','$O1','$S1','k3','internal','deliverable'), ('$KA','$O1','$S1','ka','internal','deliverable'),
  ('$KB','$O1','$S1','kb','internal','deliverable'), ('$KC','$O1','$S1','kc','internal','deliverable'),
  ('$KD','$O1','$S1','kd','internal','deliverable');
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state, state_reason) values
  ('$X1','$O1','$R1',101,'x1','https://example.invalid/i/101','open',null),
  ('$Y1','$O1','$R1',102,'y1','https://example.invalid/i/102','closed','completed'),
  ('$Z1','$O1','$R1',103,'z1','https://example.invalid/i/103','closed','completed'),
  ('$X2','$O1','$R1',111,'x2','https://example.invalid/i/111','open',null),
  ('$Y2','$O1','$R1',112,'y2','https://example.invalid/i/112','closed','completed'),
  ('$Z2','$O1','$R1',113,'z2','https://example.invalid/i/113','closed','completed'),
  ('$X3','$O1','$R1',121,'x3','https://example.invalid/i/121','open',null),
  ('$IQ','$O1','$R1',131,'q','https://example.invalid/i/131','open',null),
  ('$IP','$O1','$R1',141,'p','https://example.invalid/i/141','open',null),
  ('$IR','$O1','$R1',151,'r','https://example.invalid/i/151','open',null);
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  ('$O1','$K1','$X1','auto'), ('$O1','$K1','$Y1','auto'), ('$O1','$K2','$X2','auto'), ('$O1','$K2','$Y2','auto');
-- RPC の順番の確認用: KB を先に紐づける（表の中の並びは KB→KA。task_id の順とは逆）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values ('$O1','$KB','$IP','auto');
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values ('$O1','$KA','$IP','auto');
-- トリガーの順番の確認用: KC・KD に集計行を用意しておく
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values ('$O1','$KD','$IR','auto'), ('$O1','$KC','$IR','auto');
SQL

echo "== concurrency: close RPC holds the task, a manual link (trigger) on the same task waits =="
sqlq > "$WORK/conc_rpcfirst_rpc.out" 2>&1 <<SQL &
begin;
select $ROWFMT || '|' || coalesce(all_closed_at_after::text, '-') from $(apply_close 101) where task_id = '$K1';
select pg_sleep(2);
commit;
SQL
PID=$!
sleep 0.7
sqlq > "$WORK/conc_rpcfirst_link.out" 2>&1 <<SQL || true
set role authenticated;
select set_config('test.uid', '$U_OWN', false);
begin;
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by) values ('$O1', '$K1', '$Z1', 'manual', '$U_OWN');
select 'waited=' || (extract(epoch from clock_timestamp() - transaction_timestamp()) > 0.5)::text;
commit;
SQL
wait "$PID" || true
LINE="$(first_line '^[0-9]+>' "$WORK/conc_rpcfirst_rpc.out")"
WANT_TS="${LINE#*|}"; [ -n "$LINE" ] || WANT_TS="<no rpc result>"
ROLL="$(rollup_of "$K1")"
check_eq conc_rpc_first_rpc_reports "${LINE%%|*}" "1>0:true"
check_eq conc_rpc_first_link_waited "$(first_line '^waited=' "$WORK/conc_rpcfirst_link.out")" "waited=true"
check_eq conc_rpc_first_counts "${ROLL%%|*}" "open=0 c=3"
# トリガー側も「1以上→0」を見ていたら all_closed_at を自分の時刻で入れ直す。RPC の時刻のままなら報告は RPC の1回だけ
check_eq conc_rpc_first_no_second_report "${ROLL#*|}" "$WANT_TS"

echo "== concurrency: a manual link (trigger) holds the task, the close RPC waits =="
sqlq > "$WORK/conc_trigfirst_link.out" 2>&1 <<SQL &
set role authenticated;
select set_config('test.uid', '$U_OWN', false);
begin;
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by) values ('$O1', '$K2', '$Z2', 'manual', '$U_OWN');
select pg_sleep(2);
commit;
SQL
PID=$!
sleep 0.7
sqlq > "$WORK/conc_trigfirst_rpc.out" 2>&1 <<SQL || true
select $ROWFMT || '|' || coalesce(all_closed_at_after::text, '-')
       || '|waited=' || (extract(epoch from clock_timestamp() - statement_timestamp()) > 0.5)::text
  from $(apply_close 111) where task_id = '$K2';
SQL
wait "$PID" || true
LINE="$(first_line '^[0-9]+>' "$WORK/conc_trigfirst_rpc.out")"
REST="${LINE#*|}"; WANT_TS="${REST%%|*}"; [ -n "$LINE" ] || WANT_TS="<no rpc result>"
ROLL="$(rollup_of "$K2")"
check_eq conc_trigger_first_rpc_reports "${LINE%%|*}" "1>0:true"
check_eq conc_trigger_first_rpc_waited "${REST#*|}" "waited=true"
check_eq conc_trigger_first_counts "${ROLL%%|*}" "open=0 c=3"
check_eq conc_trigger_first_no_second_report "${ROLL#*|}" "$WANT_TS"

echo "== concurrency: a link to the same issue is being added while the close RPC runs =="
sqlq > "$WORK/conc_linkclose_link.out" 2>&1 <<SQL &
begin;
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values ('$O1', '$K3', '$X3', 'auto');
select pg_sleep(2);
commit;
SQL
PID=$!
sleep 0.7
sqlq > "$WORK/conc_linkclose_rpc.out" 2>&1 <<SQL || true
select $ROWFMT || '|waited=' || (extract(epoch from clock_timestamp() - statement_timestamp()) > 0.5)::text
  from $(apply_close 121) where task_id = '$K3';
SQL
wait "$PID" || true
LINE="$(first_line '^[0-9]+>' "$WORK/conc_linkclose_rpc.out")"
ROLL="$(rollup_of "$K3")"
check_eq conc_link_during_close_rpc_includes_task "${LINE%%|*}" "1>0:true"
check_eq conc_link_during_close_rpc_waited "${LINE#*|}" "waited=true"
check_eq conc_link_during_close_counts "${ROLL%%|*}" "open=0 c=1"

echo "== concurrency: the RPC locks tasks in task_id order =="
sqlq > "$WORK/conc_rpcorder_hold.out" 2>&1 <<SQL &
begin;
select 1 from public.task_github_issue_rollups where task_id = '$KA' for update;
select pg_sleep(2.5);
commit;
SQL
P1=$!
sleep 0.4
sqlq > "$WORK/conc_rpcorder_rpc.out" 2>&1 <<SQL &
select string_agg(right(task_id::text, 1) || '=' || $ROWFMT, ',' order by task_id) from $(apply_close 141);
SQL
P2=$!
sleep 0.8
if sqlq -c "select 1 from public.task_github_issue_rollups where task_id = '$KB' for update nowait" >/dev/null 2>"$WORK/nowait_rpcorder.err"; then
  record "PASS[conc_rpc_locks_in_task_order]: KB was free while the RPC waited for KA"
else
  record "FAIL[conc_rpc_locks_in_task_order]: $(head -1 "$WORK/nowait_rpcorder.err")"
fi
wait "$P1" || true; wait "$P2" || true
check_eq conc_rpc_lock_order_result "$(first_line '^a=' "$WORK/conc_rpcorder_rpc.out")" "a=1>0:true,b=1>0:true"

echo "== concurrency: the link trigger locks tasks in task_id order =="
sqlq > "$WORK/conc_trigorder_hold.out" 2>&1 <<SQL &
begin;
select 1 from public.task_github_issue_rollups where task_id = '$KC' for update;
select pg_sleep(2.5);
commit;
SQL
P1=$!
sleep 0.4
sqlq > "$WORK/conc_trigorder_link.out" 2>&1 <<SQL &
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values ('$O1', '$KD', '$IQ', 'auto'), ('$O1', '$KC', '$IQ', 'auto');
SQL
P2=$!
sleep 0.8
if sqlq -c "select 1 from public.task_github_issue_rollups where task_id = '$KD' for update nowait" >/dev/null 2>"$WORK/nowait_trigorder.err"; then
  record "PASS[conc_trigger_locks_in_task_order]: KD was free while the trigger waited for KC"
else
  record "FAIL[conc_trigger_locks_in_task_order]: $(head -1 "$WORK/nowait_trigorder.err")"
fi
wait "$P1" || true; wait "$P2" || true
check_eq conc_trigger_lock_order_counts "$(sqlq -c "select string_agg(right(task_id::text, 1) || '=' || open_count, ',' order by task_id) from public.task_github_issue_rollups where task_id in ('$KC', '$KD')" 2>/dev/null || true)" "c=2,d=2"

if grep -H "ERROR" "$WORK"/conc_*.out > "$WORK/conc_errors.txt" 2>/dev/null; then
  record "FAIL[conc_no_errors]: $(head -1 "$WORK/conc_errors.txt")"
else
  record "PASS[conc_no_errors]: no deadlock or other error in any concurrent session"
fi

echo "== re-apply with data present =="
if apply "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback section =="
RB="$WORK/rollback.sql"
# 「-- ロールバック」見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として取り出す
awk '/^-- ロールバック/{f=1; next} f && /^-- ====/{exit} f && /^--   /{sub(/^--   /, ""); print}' "$TARGET" > "$RB"
echo "-- rollback statements:"; sed 's/^/     /' "$RB"
NDROP="$(grep -ciE '^drop ' "$RB" || true)"
if [ "$NDROP" -eq 7 ]; then record "PASS[rollback_section_found]: $NDROP drop statements"; else record "FAIL[rollback_section_found]: got $NDROP drop statements, want 7"; fi
if psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$RB" >/dev/null; then
  record "PASS[rollback_applies]: ok"
  fingerprint > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  if apply "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
else
  record "FAIL[rollback_applies]: rollback section failed"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "GITHUB ISSUES LINK CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL GITHUB ISSUES LINK CHECKS PASSED (on real migrations)"
