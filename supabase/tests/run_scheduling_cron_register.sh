#!/usr/bin/env bash
# =============================================================================
# 日程調整の定期処理2本（期限切れ・催促）を pg_cron に登録する migration の検証ハーネス
#
# 使い捨てクラスタで _local_bootstrap → pg_cron の代役（harness/pg_cron_stub.sql）→
# 本 migration 以外の全 migration を順に verbatim 適用 → 本 migration（2回適用して冪等も確認）→ 検証 → 破棄。
# 代役を先に入れるので、ほかの定期処理の migration も本番と同じく job を登録する。
#
# assert の label:
#   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
# 続けて GREEN のときだけ:
#   replace_*   同じ名前の古い job（周期・中身が違う・止めてある）があると、作り直されて1つだけになる
#   nocron_*    pg_cron が無い DB では何もせずに通る
#   rollback_*  migration 末尾のロールバック節で2本が消え、ほかの job は変わらない → 再適用できる
#
# 使い方:
#   bash supabase/tests/run_scheduling_cron_register.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_scheduling_cron_register.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS することを確認する
# 必要: initdb / pg_ctl / psql / createdb（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

WORK="$(mktemp -d /tmp/schedcron.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54457
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

EXPIRE_NAME='scheduling-expire-proposals'
EXPIRE_SCHEDULE='*/5 * * * *'
EXPIRE_COMMAND='select public.process_scheduling_expirations()'
REMIND_NAME='scheduling-reminders'
REMIND_SCHEDULE='*/15 * * * *'
REMIND_COMMAND='select public.process_scheduling_reminders()'

# 本 migration の2本以外の job の並び（変わっていないかを見る）
other_jobs(){ q "$1" "select coalesce(string_agg(jobname || ' | ' || schedule || ' | ' || command || ' | ' || username || ' | ' || active, E'\n' order by jobname), '') from cron.job where jobname is distinct from '$EXPIRE_NAME' and jobname is distinct from '$REMIND_NAME'"; }

echo "== base: bootstrap + pg_cron stand-in =="
newdb base
apply base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/pg_cron_stub.sql"

echo "== all other migrations in order (verbatim) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  case "$(basename "$f")" in *_scheduling_cron_register.sql) continue ;; esac
  if ! PGOPTIONS='--client-min-messages=warning' psql "$(conn base)" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$WORK/mig_err.txt"; then
    echo "apply failed: $(basename "$f")"
    grep -m3 "ERROR" "$WORK/mig_err.txt" || cat "$WORK/mig_err.txt"
    exit 1
  fi
  n=$((n + 1))
done
echo "-- applied $n migrations"

TARGET=""
newdb -T base pre
other_jobs base > "$WORK/other_before.txt"
if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  shopt -s nullglob
  targets=("$MIG"/*_scheduling_cron_register.sql)
  shopt -u nullglob
  if [ "${#targets[@]}" -ne 1 ]; then
    echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
  fi
  TARGET="${targets[0]}"
  echo "== target migration (verbatim, applied twice = idempotent) =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

# 名前の job がちょうど1つで、周期・中身・登録ロール・有効・実行 DB が意図どおり
check_job(){ # label db jobname schedule command
  local got want
  got="$(q "$2" "select count(*) || ' | ' || coalesce(string_agg(schedule || ' | ' || command || ' | ' || username || ' | ' || active || ' | ' || database, ' ;; '), '') from cron.job where jobname = '$3'")"
  want="1 | $4 | $5 | postgres | true | $2"
  if [ "$got" = "$want" ]; then record "PASS[$1]: $got"; else record "FAIL[$1]: want [$want] got [$got]"; fi
}

# 登録された中身をそのまま流して、エラーなく動く（呼ぶ関数があり、実行できる）
check_command_runs(){ # label db jobname
  local cmd out
  cmd="$(q "$2" "select command from cron.job where jobname = '$3'")"
  if [ -z "$cmd" ]; then record "FAIL[$1]: job not found"; return; fi
  if out="$(psql "$(conn "$2")" -qtA -v ON_ERROR_STOP=1 -c "$cmd" 2>&1)"; then
    record "PASS[$1]: $out"
  else
    record "FAIL[$1]: $out"
  fi
}

echo "== checks =="
check_job chg_expire_job_one_after_two_applies base "$EXPIRE_NAME" "$EXPIRE_SCHEDULE" "$EXPIRE_COMMAND"
check_job chg_reminders_job_one_after_two_applies base "$REMIND_NAME" "$REMIND_SCHEDULE" "$REMIND_COMMAND"
check_command_runs chg_expire_command_runs base "$EXPIRE_NAME"
check_command_runs chg_reminders_command_runs base "$REMIND_NAME"

# 呼ぶ関数は前の migration で既にある
N="$(q base "select count(*) from pg_proc where oid in (to_regprocedure('public.process_scheduling_expirations()'), to_regprocedure('public.process_scheduling_reminders()'))")"
if [ "$N" = "2" ]; then record "PASS[same_functions_exist]: 2"; else record "FAIL[same_functions_exist]: $N"; fi

# 代役が効いて、ほかの定期処理の migration も job を登録している
N="$(grep -c . "$WORK/other_before.txt" || true)"
if [ "$N" -gt 0 ]; then record "PASS[same_stub_registers_other_jobs]: $N job(s)"; else record "FAIL[same_stub_registers_other_jobs]: none"; fi

# ほかの job は1つも変わらない
other_jobs base > "$WORK/other_after.txt"
if diff -u "$WORK/other_before.txt" "$WORK/other_after.txt" > "$WORK/other.diff"; then
  record "PASS[same_other_jobs_untouched]: identical"
else
  record "FAIL[same_other_jobs_untouched]: differs"; cat "$WORK/other.diff"
fi

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  NPASS="$(grep -c '^PASS\[' "$RES" || true)"
  NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  BAD_FAIL="$( (grep -oE '^FAIL\[[a-z0-9_]+\]' "$RES" || true) | grep -v '^FAIL\[chg_' || true)"
  BAD_PASS="$( (grep -oE '^PASS\[[a-z0-9_]+\]' "$RES" || true) | grep '^PASS\[chg_' || true)"
  if [ -n "$BAD_FAIL" ]; then echo "RED MISMATCH: same_* failed without the migration:"; printf '  %s\n' $BAD_FAIL; exit 1; fi
  if [ -n "$BAD_PASS" ]; then echo "RED MISMATCH: chg_* passed without the migration:"; printf '  %s\n' $BAD_PASS; exit 1; fi
  if [ "$NFAIL" -eq 0 ]; then echo "RED NOT REPRODUCED: no assert failed without the migration"; exit 1; fi
  echo ""
  echo "RED CONFIRMED: all $NFAIL chg_* assert(s) fail and all $NPASS same_* assert(s) pass without the migration"
  exit 0
fi

echo "== replace: older same-name jobs are rebuilt, leaving one each =="
newdb -T pre replace
psql "$(conn replace)" -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
select cron.schedule('$EXPIRE_NAME', '0 0 * * *', 'select process_scheduling_expirations()');
select cron.schedule('$REMIND_NAME', '0 * * * *', 'select process_scheduling_reminders()');
update cron.job set active = false where jobname = '$REMIND_NAME';
SQL
apply replace "$TARGET"
check_job replace_expire_rebuilt replace "$EXPIRE_NAME" "$EXPIRE_SCHEDULE" "$EXPIRE_COMMAND"
check_job replace_reminders_rebuilt replace "$REMIND_NAME" "$REMIND_SCHEDULE" "$REMIND_COMMAND"

echo "== nocron: without pg_cron the migration does nothing =="
newdb nocron
if apply nocron "$TARGET" 2> "$WORK/nocron.err"; then
  N="$(q nocron "select count(*) from pg_namespace where nspname = 'cron'")"
  if [ "$N" = "0" ]; then record "PASS[nocron_noop]: applied, nothing created"; else record "FAIL[nocron_noop]: cron schema appeared"; fi
else
  record "FAIL[nocron_noop]: $(cat "$WORK/nocron.err")"
fi

echo "== rollback section =="
newdb -T base rb
RB="$WORK/rollback.sql"
awk '/^-- ロールバック/{f=1; next} f && /^-- ====/{exit} f && /^--   /{sub(/^--   /, ""); print}' "$TARGET" > "$RB"
echo "-- rollback statements:"; sed 's/^/     /' "$RB"
if [ -s "$RB" ] && psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" >/dev/null; then
  N="$(q rb "select count(*) from cron.job where jobname in ('$EXPIRE_NAME', '$REMIND_NAME')")"
  if [ "$N" = "0" ]; then record "PASS[rollback_removes_both]: 0 left"; else record "FAIL[rollback_removes_both]: $N left"; fi
  other_jobs rb > "$WORK/other_rb.txt"
  if diff -u "$WORK/other_before.txt" "$WORK/other_rb.txt" > "$WORK/other_rb.diff"; then
    record "PASS[rollback_keeps_other_jobs]: identical"
  else
    record "FAIL[rollback_keeps_other_jobs]: differs"; cat "$WORK/other_rb.diff"
  fi
  if apply rb "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  check_job rollback_reapplied_expire rb "$EXPIRE_NAME" "$EXPIRE_SCHEDULE" "$EXPIRE_COMMAND"
  check_job rollback_reapplied_reminders rb "$REMIND_NAME" "$REMIND_SCHEDULE" "$REMIND_COMMAND"
else
  record "FAIL[rollback_applies]: rollback section missing or failed"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ]; then echo "NOT PASSED"; exit 1; fi
echo ""
echo "ALL SCHEDULING CRON REGISTER CHECKS PASSED (on real migrations)"
