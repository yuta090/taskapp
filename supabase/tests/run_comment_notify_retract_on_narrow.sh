#!/usr/bin/env bash
# =============================================================================
# 見せ方を狭めたときにコメントのお知らせを消す（*_comment_notify_retract_on_narrow.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで。20260915105122_task_comment_notify.sql を含む）、
# 検証に使うデータベースを作る。migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役）を足す。
# migration は1行も変えない。
# 本 migration の前に comment_notify_retract_on_narrow_seed.sql で人物・タスク・コメント・お知らせを作り、
# 本 migration を2回適用して（冪等）、comment_notify_retract_on_narrow_assert.sql で確かめる:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  変えないもの（両方で PASS）
# assert の出力から、お知らせを消すのが失敗したときの警告が出たかも見る
# （削除そのものが失敗したとき: chg_visibility_retract_failure_warns / chg_scope_retract_failure_warns。判定の補助関数も後備えも
#  失敗したとき: chg_*_fallback_failure_warns。どちらも両方の理由が1つの警告に出る。後備えで消せたときも、消した件数と判定の失敗の
#  理由を警告に1行出す: chg_*_fallback_success_warns）。
# 続けて GREEN のときだけ:
#   lock_*      適用中に持つロック（pg_locks・自分のセッション・取れたもの）。1回目・2回目・データが入った状態の再適用のどれでも、
#               tasks と task_comments に AccessExclusiveLock を持たず、share row exclusive で押さえている。
#               見方が正しいことを、既にあるトリガーを drop trigger if exists で消す（AccessExclusiveLock を取る）ことで確かめる。
#               lock_order_*: 取る順番が tasks → task_comments であること（本 migration と、先頭のコメントのロールバックの手順）
#   scope_*     本 migration で増えるのは、関数2つ・トリガー2つだけ。ほかの関数・トリガー・ポリシー・列・表の権限・制約は変わらない
#   reapply_*   データが入った状態で再適用できる（お知らせが変わらない・そのあとも1回だけ消す）
#   rollback_*  先頭のコメントの「ロールバック（手で流す」の手順を流すと、適用前のスキーマに戻り、見せ方を狭めても
#               お知らせが消えない → 戻したあと再適用できる
#   stop_*      先頭のコメントの「緊急に止める（手で流す」の手順を流すと、表のロックを取らずに止まり（関数2つの本体が変わるだけ。
#               実行権・トリガーはそのまま）、見せ方を狭めてもお知らせが消えない → 本 migration を流し直すと元に戻る
#   guard_*     同じ名前の別のトリガーがあるとき・前提の補助関数が無いときは、適用が止まり、何も変わらない
#   perf_*      大量のデータ（タスク2,000・コメント10,000・お知らせ240,000）で、トリガーの中の問い合わせの実行計画
#               （auto_explain・1回目の計画と使い回しの計画の両方）が索引を使い、コメントの無いタスクでは消す問い合わせを
#               流さないこと。判定の補助関数が失敗して、判定を使わずに消すとき（後備え）の問い合わせも索引を使うこと。
#               ボールの受け渡しではトリガーが動かないこと。見せ方の変更1回あたりのトリガーの時間も出す（CRN_SHOW_PLANS=1 で計画も出す）
#
# 使い方:
#   bash supabase/tests/run_comment_notify_retract_on_narrow.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_comment_notify_retract_on_narrow.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#       （本 migration のファイルがまだ無いときは、今ある migrations を全部流す）
# 一時データの置き場所は WORK_BASE で変えられる（既定 $TMPDIR）。
# 接続は 127.0.0.1 の TCP だけ（ソケットのファイルは作らない）。ポートは CRN_PORT で変えられる（既定 55495）。
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb・contrib の auto_explain）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

shopt -s nullglob
targets=("$MIG"/*_comment_notify_retract_on_narrow.sql)
shopt -u nullglob
if [ "${#targets[@]}" -eq 1 ]; then
  TARGET="${targets[0]}"
elif [ "${#targets[@]}" -eq 0 ] && [ "$RED" = "1" ]; then
  TARGET=""
else
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi

PORT="${CRN_PORT:-55495}"
HOST="127.0.0.1"
if pg_isready -h "$HOST" -p "$PORT" -q; then
  echo "port $PORT is already in use (set CRN_PORT)"; exit 1
fi

WORK_BASE="${WORK_BASE:-${TMPDIR:-/tmp}}"
WORK="$(mktemp -d "${WORK_BASE%/}/crn.XXXXXX")"
PGDATA="$WORK/data"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster (127.0.0.1:$PORT) =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
{
  echo "port = $PORT"
  echo "listen_addresses = '$HOST'"
  echo "unix_socket_directories = ''"
} >> "$PGDATA/postgresql.conf"
pg_ctl -D "$PGDATA" -l "$WORK/server.log" -w start >/dev/null
conn(){ echo "host=$HOST port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$HOST" -p "$PORT" -U postgres "$@"; }

# 本 migration・確認用の SQL は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（データは含まない）
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'fn ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || ' ' || md5(p.prosrc) as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
         || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t where not t.tgisinternal
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'con ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    from pg_constraint c where c.connamespace = 'public'::regnamespace
) s order by x;
SQL
}
# 本 migration で増える物（指紋の行）
NEW_RE='app_task_comment_retract_on_visibility_change|app_task_comment_retract_on_task_scope_change|task_comments_retract_on_visibility_change|tasks_retract_comment_notice_on_scope_change'

# SQL ファイルを1トランザクションで流し、コミットの直前に自分が持っている表のロック（取れたもの）を返す
#   例: task_comments=ShareRowExclusiveLock,tasks=ShareRowExclusiveLock
held_locks(){
  local wrap="$WORK/lock_wrap.sql"
  {
    printf '\\i %s\n' "$2"
    cat <<'SQL'
select coalesce(string_agg(c.relname || '=' || l.mode, ',' order by c.relname, l.mode), '(none)')
  from pg_locks l
  join pg_class c on c.oid = l.relation
 where l.pid = pg_backend_pid()
   and l.granted
   and l.locktype = 'relation'
   and c.relnamespace = 'public'::regnamespace
   and c.relname in ('tasks', 'task_comments', 'notifications');
SQL
  } > "$wrap"
  PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -1 -f "$wrap"
}
# tasks / task_comments に AccessExclusiveLock が無く、どちらも ShareRowExclusiveLock で押さえている
lock_verdict(){
  local s=",$2,"
  case "$s" in
    *",tasks=AccessExclusiveLock,"*|*",task_comments=AccessExclusiveLock,"*)
      record "FAIL[$1]: $2"; return ;;
  esac
  case "$s" in
    *",task_comments=ShareRowExclusiveLock,"*) ;;
    *) record "FAIL[$1]: $2 (want ShareRowExclusiveLock on task_comments)"; return ;;
  esac
  case "$s" in
    *",tasks=ShareRowExclusiveLock,"*) record "PASS[$1]: $2" ;;
    *) record "FAIL[$1]: $2 (want ShareRowExclusiveLock on tasks)" ;;
  esac
}

# 表のロックを取る順番（tasks → task_comments）。別のセッションが task_comments を share で押さえている間に SQL ファイルを流し、
#   待っているあいだに持っている表のロックを見る。tasks を先に取るなら「tasks は取れていて、task_comments を待っている」
#   （task_comments を先に取ると、task_comments を待つだけで、tasks はまだ持っていない）。見終わったら押さえを外す
#   （流したファイルはそのまま最後まで進むので、使い捨ての DB で流す）
lock_order_probe(){  # $1 = label, $2 = db, $3 = SQL ファイル, $4 = 期待（表=ロック:granted|waiting をカンマ区切り）
  local label="$1" db="$2" file="$3" want="$4" got holder prober i
  psql "$(conn "$db") application_name=crn_lock_holder" -qtA \
    -c "begin; lock table public.task_comments in share mode; select pg_sleep(30); commit;" >/dev/null 2>&1 &
  holder=$!
  for i in $(seq 1 100); do
    [ "$(q "$db" "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                   where a.application_name = 'crn_lock_holder' and l.granted
                     and l.relation = 'public.task_comments'::regclass")" = "1" ] && break
    sleep 0.1
  done
  PGOPTIONS='--client-min-messages=warning' psql "$(conn "$db") application_name=crn_lock_probe" -q -v ON_ERROR_STOP=1 -1 \
    -f "$file" >/dev/null 2>&1 &
  prober=$!
  for i in $(seq 1 50); do
    [ "$(q "$db" "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                   where a.application_name = 'crn_lock_probe' and not l.granted")" != "0" ] && break
    sleep 0.05
  done
  got="$(q "$db" "select coalesce(string_agg(c.relname || '=' || l.mode || ':' || case when l.granted then 'granted' else 'waiting' end,
                                           ',' order by c.relname, l.mode), '(none)')
                    from pg_locks l
                    join pg_stat_activity a on a.pid = l.pid
                    join pg_class c on c.oid = l.relation
                   where a.application_name = 'crn_lock_probe'
                     and l.locktype = 'relation'
                     and c.relnamespace = 'public'::regnamespace
                     and c.relname in ('tasks', 'task_comments')")"
  q "$db" "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'crn_lock_holder'" >/dev/null
  wait "$holder" 2>/dev/null || true
  wait "$prober" 2>/dev/null || true
  if [ "$got" = "$want" ]; then record "PASS[$label]: $got"; else record "FAIL[$label]: $got (want $want)"; fi
}

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"

echo "== prior migrations (verbatim, same order as verify-migrations-from-scratch.sh, up to the target) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  [ -n "$TARGET" ] && [ "$f" = "$TARGET" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

# 前提: コメントのお知らせ（20260915105122_task_comment_notify.sql）が入っている
PREREQ="$(q base "select (to_regprocedure('public.app_task_comment_notify()') is not null
                     and to_regprocedure('public.app_task_comment_visible_to_user(uuid,uuid,uuid,uuid,text)') is not null
                     and to_regclass('public.notifications_task_comment_dedupe_idx') is not null)::text")"
if [ "$PREREQ" != "true" ]; then
  echo "prerequisite missing: *_task_comment_notify.sql has not been applied"; exit 1
fi

echo "== seed: 人物・タスク・コメント・お知らせ（本 migration の前からあるデータ） =="
apply base "$TST/comment_notify_retract_on_narrow_seed.sql"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  # 本 migration の前の状態を残しておく（scope_* / rollback_* / guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  L1="$(held_locks base "$TARGET")"
  lock_verdict lock_first_apply "$L1"
  L2="$(held_locks base "$TARGET")"
  lock_verdict lock_second_apply "$L2"
  # 見方が正しいこと: 既にあるトリガーを drop trigger if exists で消すと、tasks に AccessExclusiveLock を取る
  #   （作って消すので、pre の中身は変わらない）
  printf '%s\n' \
    "create trigger crn_lock_probe after update on public.tasks for each row execute function public.update_task_comments_updated_at();" \
    "drop trigger if exists crn_lock_probe on public.tasks;" > "$WORK/drop_probe.sql"
  LP="$(held_locks pre "$WORK/drop_probe.sql")"
  case ",$LP," in
    *",tasks=AccessExclusiveLock,"*) record "PASS[lock_detector_sees_drop_trigger]: $LP" ;;
    *) record "FAIL[lock_detector_sees_drop_trigger]: $LP" ;;
  esac
  # 参考（数えない）: 無いトリガーへの drop trigger if exists が持つ表のロック
  printf 'drop trigger if exists crn_no_such_trigger on public.tasks;\n' > "$WORK/drop_missing_probe.sql"
  echo "   (info) drop trigger if exists on a missing trigger holds: $(held_locks pre "$WORK/drop_missing_probe.sql")"
  # 取る順番: tasks を先に取る（アプリで両方の表に書くトランザクションは、タスクを消す → コメントが連鎖して消える の順）
  newdb -T pre lk_mig
  lock_order_probe lock_order_migration_tasks_first lk_mig "$TARGET" \
    "task_comments=ShareRowExclusiveLock:waiting,tasks=ShareRowExclusiveLock:granted"
fi

newdb -T base checks

echo "== checks: comment_notify_retract_on_narrow_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/comment_notify_retract_on_narrow_assert.sql" > "$OUT" 2>&1
set -e
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# assert の中のエラーは test.run が文字列にして返すので、ここに出る ERROR はハーネスかテストデータの不備
if grep -q "ERROR" "$OUT"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

# お知らせを消すのが失敗したとき、元の更新は止めずに警告を出す
#   削除そのものが失敗する区切り（判定を使う削除も、判定を使わない削除も失敗する）: 両方の理由を1つの警告に出す
DELETE_BOTH='（判定: P0001: test: お知らせを消せない / 判定を使わずに消す: P0001: test: お知らせを消せない）'
W_DEL_VIS="$(grep "WARNING:  task comment visibility retract: " "$OUT" | grep -F "$DELETE_BOTH" | head -1 || true)"
if [ -n "$W_DEL_VIS" ]; then
  record "PASS[chg_visibility_retract_failure_warns]: $(printf '%s' "$W_DEL_VIS" | grep -o 'task comment visibility retract: .*')"
else
  record "FAIL[chg_visibility_retract_failure_warns]: no warning with both reasons"
fi
W_DEL_SCOPE="$(grep "WARNING:  task scope comment retract: " "$OUT" | grep -F "$DELETE_BOTH" | head -1 || true)"
if [ -n "$W_DEL_SCOPE" ]; then
  record "PASS[chg_scope_retract_failure_warns]: $(printf '%s' "$W_DEL_SCOPE" | grep -o 'task scope comment retract: .*')"
else
  record "FAIL[chg_scope_retract_failure_warns]: no warning with both reasons"
fi
# 判定（補助関数）も、判定を使わずに消す後備えも失敗したときは、両方の理由を1つの警告に出す
FALLBACK_BOTH='（判定: P0001: test: 判定の補助関数が壊れた / 判定を使わずに消す: P0001: test: お知らせを消せない）'
W_VIS="$(grep "WARNING:  task comment visibility retract: " "$OUT" | grep -F "$FALLBACK_BOTH" | head -1 || true)"
if [ -n "$W_VIS" ]; then
  record "PASS[chg_visibility_fallback_failure_warns]: $(printf '%s' "$W_VIS" | grep -o 'task comment visibility retract: .*')"
else
  record "FAIL[chg_visibility_fallback_failure_warns]: no warning with both reasons"
fi
W_SCOPE="$(grep "WARNING:  task scope comment retract: " "$OUT" | grep -F "$FALLBACK_BOTH" | head -1 || true)"
if [ -n "$W_SCOPE" ]; then
  record "PASS[chg_scope_fallback_failure_warns]: $(printf '%s' "$W_SCOPE" | grep -o 'task scope comment retract: .*')"
else
  record "FAIL[chg_scope_fallback_failure_warns]: no warning with both reasons"
fi
# 後備えで消せたときも、消した件数と判定の失敗の理由を警告に1行出す（assert の MARK fallback_success_begin 〜 end の間。
#   判定の仕組みが壊れて、社内の人の通知まで消え続けても気づけるように）。コメント側・タスク側で1行ずつ
FB_WARNINGS="$WORK/fallback_success_warnings.txt"
awk '/MARK fallback_success_begin/ { f = 1; next } /MARK fallback_success_end/ { f = 0 } f && /WARNING:/' "$OUT" > "$FB_WARNINGS"
fallback_success_warns(){  # $1 = label, $2 = 警告の頭, $3 = 警告に含まれるべき文
  local n w
  n="$(grep -c "WARNING:  $2" "$FB_WARNINGS" || true)"
  w="$(grep "WARNING:  $2" "$FB_WARNINGS" | grep -F "$3" | head -1 || true)"
  if grep -q "MARK fallback_success_end" "$OUT" && [ "$n" = "1" ] && [ -n "$w" ]; then
    record "PASS[$1]: $(printf '%s' "$w" | grep -o "$2.*")"
  else
    record "FAIL[$1]: $n warning(s) $(grep "WARNING:  $2" "$FB_WARNINGS" | head -1) (want 1 with: $3)"
  fi
}
fallback_success_warns chg_visibility_fallback_success_warns "task comment visibility retract: " \
  'コメント f0000000-0000-0000-0000-000000000001 のお知らせ 3 件を、判定を使わずに宛先を問わず消しました（判定: P0001: test: 判定の補助関数が壊れた）'
fallback_success_warns chg_scope_fallback_success_warns "task scope comment retract: " \
  'タスク d0000000-0000-0000-0000-000000000001 のコメントのお知らせ 6 件を、判定を使わずに宛先を問わず消しました（判定: P0001: test: 判定の補助関数が壊れた）'

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  NPASS="$(grep -c '^PASS\[' "$RES" || true)"
  NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
  echo "PASS: $NPASS  FAIL: $NFAIL"
  FAIL_LABELS="$(grep -oE '^FAIL\[[a-z0-9_]+\]' "$RES" | sed -E 's/^FAIL\[(.*)\]$/\1/' | sort -u || true)"
  PASS_LABELS="$(grep -oE '^PASS\[[a-z0-9_]+\]' "$RES" | sed -E 's/^PASS\[(.*)\]$/\1/' | sort -u || true)"
  BAD_FAIL="$(printf '%s\n' "$FAIL_LABELS" | grep -v '^$' | grep -v '^chg_' || true)"
  BAD_PASS="$(printf '%s\n' "$PASS_LABELS" | grep '^chg_' || true)"
  if [ -n "$BAD_FAIL" ]; then
    echo "RED MISMATCH: same_* did not hold without the migration (the label should be chg_*, or the expectation is wrong):"
    printf '  %s\n' $BAD_FAIL; exit 1
  fi
  if [ -n "$BAD_PASS" ]; then
    echo "RED MISMATCH: chg_* held without the migration (the assert does not detect the change):"
    printf '  %s\n' $BAD_PASS; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: every assert held without the migration"; exit 1
  fi
  echo ""
  echo "RED CONFIRMED: without the migration, all $NFAIL chg_* assert(s) do not hold and all $NPASS same_* assert(s) hold"
  exit 0
fi

echo "== scope: 増えるのは関数2つ・トリガー2つだけ =="
fingerprint base > "$WORK/fp_after_full.txt"
N_BEFORE_NEW="$(grep -cE "$NEW_RE" "$WORK/fp_before.txt" || true)"
grep -vE "$NEW_RE" "$WORK/fp_after_full.txt" > "$WORK/fp_after.txt" || true
if [ "$N_BEFORE_NEW" = "0" ] && diff -q "$WORK/fp_before.txt" "$WORK/fp_after.txt" >/dev/null; then
  record "PASS[scope_only_intended_objects_changed]: same"
else
  record "FAIL[scope_only_intended_objects_changed]: before_new=$N_BEFORE_NEW $(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | head -5 | tr '\n' ' ')"
fi
N_ADDED="$(grep -cE "$NEW_RE" "$WORK/fp_after_full.txt" || true)"
if [ "$N_ADDED" = "4" ]; then
  record "PASS[scope_added_objects]: $N_ADDED"
else
  record "FAIL[scope_added_objects]: $N_ADDED (want 4) $(grep -E "$NEW_RE" "$WORK/fp_after_full.txt" | tr '\n' ' ')"
fi
N_TRG="$(q base "select format('%s|%s',
  (select count(*) from pg_trigger where tgrelid = 'public.task_comments'::regclass
      and tgfoid = to_regprocedure('public.app_task_comment_retract_on_visibility_change()')),
  (select count(*) from pg_trigger where tgrelid = 'public.tasks'::regclass
      and tgfoid = to_regprocedure('public.app_task_comment_retract_on_task_scope_change()')))")"
if [ "$N_TRG" = "1|1" ]; then record "PASS[scope_single_trigger_after_twice]: $N_TRG"; else record "FAIL[scope_single_trigger_after_twice]: $N_TRG (want 1|1)"; fi

echo "== re-apply with data present =="
N_BEFORE="$(q checks "select count(*) || '/' || md5(string_agg(id::text, ',' order by id)) from public.notifications")"
if L3="$(held_locks checks "$TARGET")"; then
  record "PASS[reapply_with_data]: ok"
  lock_verdict lock_reapply_with_data "$L3"
else
  record "FAIL[reapply_with_data]: apply failed"
fi
N_AFTER="$(q checks "select count(*) || '/' || md5(string_agg(id::text, ',' order by id)) from public.notifications")"
if [ "$N_BEFORE" = "$N_AFTER" ]; then
  record "PASS[reapply_no_notice_change]: ${N_AFTER%%/*} rows"
else
  record "FAIL[reapply_no_notice_change]: $N_BEFORE -> $N_AFTER"
fi
# 再適用のあとも、コメントの公開範囲を狭めると相手先の行が1回だけ消える（K1 の in_app の comment_added / mention が as・nm に残る）
q checks "update public.task_comments set visibility = 'internal' where id = 'f0000000-0000-0000-0000-000000000001'" >/dev/null
N_REAPPLY="$(q checks "select string_agg(p.email, ',' order by p.email) from public.notifications n join auth.users p on p.id = n.to_user_id
                       where n.dedupe_key = 'task_comment:f0000000-0000-0000-0000-000000000001'
                         and n.channel = 'in_app' and n.type in ('comment_added', 'mention')")"
if [ "$N_REAPPLY" = "as@example.com,nm@example.com" ]; then
  record "PASS[reapply_behaviour]: $N_REAPPLY"
else
  record "FAIL[reapply_behaviour]: $N_REAPPLY (want as@example.com,nm@example.com)"
fi

echo "== rollback: 先頭のコメントの手順を流す =="
RB="$WORK/rollback.sql"
# 「-- ロールバック（手で流す」の行から次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として取り出す
awk '
  /^-- ロールバック（手で流す/ { f = 1; next }
  f && /^-- ====/ { exit }
  f && /^--   / { line = $0; sub(/^--   /, "", line); print line }
' "$TARGET" > "$RB"
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NSTMT" -eq 6 ]; then
  record "PASS[rollback_steps_found]: $NSTMT statements"
else
  record "FAIL[rollback_steps_found]: $NSTMT statements (want 6)"
fi
# 取る順番: 本 migration と同じく tasks を先に
newdb -T base lk_rb
lock_order_probe lock_order_rollback_tasks_first lk_rb "$RB" \
  "task_comments=AccessExclusiveLock:waiting,tasks=AccessExclusiveLock:granted"
newdb -T base rb
if apply rb "$RB" 2>"$WORK/rollback_err.txt"; then
  record "PASS[rollback_applies]: ok"
  fingerprint rb > "$WORK/fp_rb.txt"
  if diff -q "$WORK/fp_before.txt" "$WORK/fp_rb.txt" >/dev/null; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: $(diff "$WORK/fp_before.txt" "$WORK/fp_rb.txt" | head -5 | tr '\n' ' ')"
  fi
  # 戻したあとは、コメントの公開範囲やタスクの見せ方を狭めても、お知らせは消えない
  RB_BEFORE="$(q rb "select count(*) from public.notifications")"
  q rb "update public.task_comments set visibility = 'internal' where id = 'f0000000-0000-0000-0000-000000000001'" >/dev/null
  q rb "update public.tasks set client_scope = 'internal' where id = 'd0000000-0000-0000-0000-000000000002'" >/dev/null
  RB_AFTER="$(q rb "select count(*) from public.notifications")"
  if [ "$RB_BEFORE" = "$RB_AFTER" ]; then
    record "PASS[rollback_restores_behaviour]: notices kept ($RB_AFTER)"
  else
    record "FAIL[rollback_restores_behaviour]: $RB_BEFORE -> $RB_AFTER"
  fi
  if apply rb "$TARGET"; then
    record "PASS[reapply_after_rollback]: ok"
    fingerprint rb > "$WORK/fp_rb_again.txt"
    if diff -q "$WORK/fp_after_full.txt" "$WORK/fp_rb_again.txt" >/dev/null; then
      record "PASS[reapply_after_rollback_schema]: identical to post-migration"
    else
      record "FAIL[reapply_after_rollback_schema]: $(diff "$WORK/fp_after_full.txt" "$WORK/fp_rb_again.txt" | head -5 | tr '\n' ' ')"
    fi
  else
    record "FAIL[reapply_after_rollback]: apply failed"
  fi
else
  record "FAIL[rollback_applies]: $(head -1 "$WORK/rollback_err.txt")"
fi

echo "== emergency stop: 先頭のコメントの「緊急に止める」手順を流す =="
ST="$WORK/stop.sql"
# 「-- 緊急に止める（手で流す」の行から「-- ロールバック（手で流す」（か「-- ====」）までのうち、行頭が「--   」の行だけを SQL として取り出す
awk '
  /^-- 緊急に止める（手で流す/ { f = 1; next }
  f && (/^-- ロールバック（手で流す/ || /^-- ====/) { exit }
  f && /^--   / { line = $0; sub(/^--   /, "", line); print line }
' "$TARGET" > "$ST"
NSTOP="$(grep -c '^create or replace function ' "$ST" || true)"
if [ "$NSTOP" -eq 2 ]; then
  record "PASS[stop_steps_found]: $NSTOP functions"
else
  record "FAIL[stop_steps_found]: $NSTOP functions (want 2)"
fi
# コメント K1・K2 の受信トレイのお知らせ（「コメント:宛先:種類」）
stop_notices(){
  q "$1" "select coalesce(string_agg('K' || right(n.dedupe_key, 1) || ':' || split_part(u.email, '@', 1) || ':' || n.type, ','
                                     order by right(n.dedupe_key, 1), u.email, n.type), '')
            from public.notifications n join auth.users u on u.id = n.to_user_id
           where n.dedupe_key in ('task_comment:f0000000-0000-0000-0000-000000000001', 'task_comment:f0000000-0000-0000-0000-000000000002')
             and n.channel = 'in_app' and n.type in ('comment_added', 'mention')"
}
newdb -T base stop
if LS="$(held_locks stop "$ST" 2>"$WORK/stop_err.txt")"; then
  record "PASS[stop_applies]: ok"
  if [ "$LS" = "(none)" ]; then
    record "PASS[stop_takes_no_table_lock]: $LS"
  else
    record "FAIL[stop_takes_no_table_lock]: $LS"
  fi
  # 変わるのは関数2つの本体だけ（実行権・SECURITY DEFINER・search_path・トリガーは残る）
  fingerprint stop > "$WORK/fp_stop.txt"
  grep -vE "$NEW_RE" "$WORK/fp_stop.txt" > "$WORK/fp_stop_other.txt" || true
  if diff -q "$WORK/fp_after.txt" "$WORK/fp_stop_other.txt" >/dev/null; then
    record "PASS[stop_changes_nothing_else]: same"
  else
    record "FAIL[stop_changes_nothing_else]: $(diff "$WORK/fp_after.txt" "$WORK/fp_stop_other.txt" | head -5 | tr '\n' ' ')"
  fi
  ST_FORM="$(q stop "select format('%s|%s|%s|%s',
    (select string_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig, ';'), '')), ','
                       order by p.proname)
       from pg_proc p
      where p.oid in (to_regprocedure('public.app_task_comment_retract_on_visibility_change()'),
                      to_regprocedure('public.app_task_comment_retract_on_task_scope_change()'))),
    (select count(*) from unnest(array['public', 'anon', 'authenticated']) as r,
                          unnest(array['public.app_task_comment_retract_on_visibility_change()',
                                       'public.app_task_comment_retract_on_task_scope_change()']) as f
      where has_function_privilege(r, f, 'execute')),
    (select count(*) from pg_trigger where tgrelid = 'public.task_comments'::regclass and tgenabled = 'O'
        and tgfoid = to_regprocedure('public.app_task_comment_retract_on_visibility_change()')),
    (select count(*) from pg_trigger where tgrelid = 'public.tasks'::regclass and tgenabled = 'O'
        and tgfoid = to_regprocedure('public.app_task_comment_retract_on_task_scope_change()')))")"
  ST_FORM_WANT='app_task_comment_retract_on_task_scope_change:true:search_path=public,app_task_comment_retract_on_visibility_change:true:search_path=public|0|1|1'
  if [ "$ST_FORM" = "$ST_FORM_WANT" ]; then
    record "PASS[stop_keeps_function_form_and_triggers]: $ST_FORM"
  else
    record "FAIL[stop_keeps_function_form_and_triggers]: $ST_FORM (want $ST_FORM_WANT)"
  fi
  # 止めている間は、コメントの公開範囲やタスクの見せ方を狭めても、お知らせは消えない
  SB_BEFORE="$(q stop "select count(*) || '/' || md5(string_agg(id::text, ',' order by id)) from public.notifications")"
  q stop "update public.task_comments set visibility = 'internal' where id = 'f0000000-0000-0000-0000-000000000001'" >/dev/null
  q stop "update public.tasks set client_scope = 'internal' where id = 'd0000000-0000-0000-0000-000000000002'" >/dev/null
  SB_AFTER="$(q stop "select count(*) || '/' || md5(string_agg(id::text, ',' order by id)) from public.notifications")"
  if [ "$SB_BEFORE" = "$SB_AFTER" ]; then
    record "PASS[stop_behaviour]: notices kept (${SB_AFTER%%/*})"
  else
    record "FAIL[stop_behaviour]: $SB_BEFORE -> $SB_AFTER"
  fi
  # 本 migration を流し直すと元に戻る（止めている間に残った行は、次に狭めたときに判定し直して消える）
  if apply stop "$TARGET"; then
    record "PASS[stop_resume_applies]: ok"
    fingerprint stop > "$WORK/fp_stop_resume.txt"
    if diff -q "$WORK/fp_after_full.txt" "$WORK/fp_stop_resume.txt" >/dev/null; then
      record "PASS[stop_resume_schema]: identical to post-migration"
    else
      record "FAIL[stop_resume_schema]: $(diff "$WORK/fp_after_full.txt" "$WORK/fp_stop_resume.txt" | head -5 | tr '\n' ' ')"
    fi
    q stop "update public.tasks set client_scope = 'internal' where id = 'd0000000-0000-0000-0000-000000000001'" >/dev/null
    SR="$(stop_notices stop)"
    if [ "$SR" = "K1:as:comment_added,K1:nm:mention,K2:as:comment_added" ]; then
      record "PASS[stop_resume_behaviour]: $SR"
    else
      record "FAIL[stop_resume_behaviour]: $SR (want K1:as:comment_added,K1:nm:mention,K2:as:comment_added)"
    fi
  else
    record "FAIL[stop_resume_applies]: apply failed"
  fi
else
  record "FAIL[stop_applies]: $(head -1 "$WORK/stop_err.txt")"
fi

echo "== guard: 同じ名前の別のトリガー・前提の補助関数が無いときは止まる =="
g_state(){
  q "$1" "select format('%s|%s',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('app_task_comment_retract_on_visibility_change', 'app_task_comment_retract_on_task_scope_change')),
    (select count(*) from pg_trigger where not tgisinternal
        and tgname in ('task_comments_retract_on_visibility_change', 'tasks_retract_comment_notice_on_scope_change')))"
}
guard_case(){  # $1 = label, $2 = 前もって流す SQL, $3 = 止まったあとの状態（関数の数|トリガーの数）
  local db="g_$1"
  newdb -T pre "$db"
  q "$db" "$2" >/dev/null
  if apply "$db" "$TARGET" 2>"$WORK/${db}_err.txt"; then
    record "FAIL[guard_stops_$1]: applied"
  elif grep -q "comment notify retract on narrow" "$WORK/${db}_err.txt"; then
    record "PASS[guard_stops_$1]: $(grep -m1 -o 'comment notify retract on narrow: .*' "$WORK/${db}_err.txt" | cut -c1-120)"
  else
    record "FAIL[guard_stops_$1]: $(head -1 "$WORK/${db}_err.txt")"
  fi
  local st; st="$(g_state "$db")"
  if [ "$st" = "$3" ]; then
    record "PASS[guard_changes_nothing_$1]: functions|triggers=$st"
  else
    record "FAIL[guard_changes_nothing_$1]: functions|triggers=$st (want $3)"
  fi
}
guard_case other_comment_trigger \
  "create trigger task_comments_retract_on_visibility_change after update on public.task_comments
     for each row execute function public.update_task_comments_updated_at()" "0|1"
guard_case other_task_trigger \
  "create trigger tasks_retract_comment_notice_on_scope_change after update on public.tasks
     for each row execute function public.update_task_comments_updated_at()" "0|1"
guard_case missing_helper \
  "drop function public.app_task_comment_visible_to_user(uuid, uuid, uuid, uuid, text)" "0|0"

echo "== perf: 大量のデータで、トリガーの中の問い合わせの実行計画と時間を見る =="
newdb -T base perf
cat > "$WORK/perf_seed.sql" <<'SQL'
-- タスク 2,000（1〜1,000 はコメント10件ずつ・1,001〜2,000 はコメント無し）
insert into public.tasks (id, org_id, space_id, title, status, ball, origin, type, client_scope, created_by)
select format('d1000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
       format('大量 %s', i), 'in_progress', 'internal', 'internal', 'task', 'deliverable',
       'c0000000-0000-0000-0000-000000000001'
  from generate_series(1, 2000) as i;
-- コメント 10,000（書いた本人のほかに宛先が無いので、お知らせのトリガーは何も作らない）
insert into public.task_comments (id, org_id, space_id, task_id, actor_id, body, visibility)
select format('f1000000-0000-0000-%s-%s', lpad(t::text, 4, '0'), lpad(k::text, 12, '0'))::uuid,
       'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
       format('d1000000-0000-0000-0000-%s', lpad(t::text, 12, '0'))::uuid,
       'c0000000-0000-0000-0000-000000000001', '大量', case when k % 2 = 0 then 'client' else 'vendor' end
  from generate_series(1, 1000) as t, generate_series(1, 10) as k;
-- お知らせ: コメントごとに4人（40,000）＋関係ないお知らせ 200,000。プッシュの送信トリガーは動かさない
set session_replication_role = replica;
insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
select c.org_id, c.space_id, u.id, 'in_app', 'comment_added', 'task_comment:' || c.id::text, '{}'::jsonb
  from public.task_comments c
  cross join (values ('c0000000-0000-0000-0000-000000000002'::uuid), ('c0000000-0000-0000-0000-000000000003'::uuid),
                     ('c0000000-0000-0000-0000-000000000004'::uuid), ('c0000000-0000-0000-0000-000000000005'::uuid)) as u(id)
 where c.task_id::text like 'd1000000-%';
insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
select 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
       (array['c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
              'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000005']::uuid[])[1 + i % 4],
       'in_app', 'ball_passed', 'perf:' || i, '{}'::jsonb
  from generate_series(1, 200000) as i;
set session_replication_role = origin;
SQL
apply perf "$WORK/perf_seed.sql"
q perf "analyze public.tasks" >/dev/null
q perf "analyze public.task_comments" >/dev/null
q perf "analyze public.notifications" >/dev/null
PERF_ROWS="$(q perf "select format('tasks=%s comments=%s notifications=%s',
  (select count(*) from public.tasks), (select count(*) from public.task_comments), (select count(*) from public.notifications))")"
echo "   $PERF_ROWS"

T_NOC="d1000000-0000-0000-0000-000000001500"   # コメントの無いタスク
T_WC="d1000000-0000-0000-0000-000000000500"    # コメント10件・お知らせ40件のタスク
C_WC="f1000000-0000-0000-0500-000000000002"    # そのタスクの相手先向けのコメント
PERF_OUT="$WORK/perf_plans.out"
# 判定の補助関数を、呼ぶと失敗するものに差し替える（区切りの rollback で戻る）。後備えの削除の計画を見るため
BREAK_JUDGE="create or replace function public.app_task_comment_visible_to_user(p_user uuid, p_space uuid, p_org uuid, p_task uuid, p_visibility text) returns boolean language plpgsql stable security definer set search_path = public as \$b\$ begin raise exception 'perf: 判定の補助関数が壊れた'; end \$b\$;"
{
  cat <<'SQL'
load 'auto_explain';
set auto_explain.log_min_duration = 0;
set auto_explain.log_nested_statements = on;
set auto_explain.log_analyze = on;
set auto_explain.log_timing = off;
set auto_explain.log_level = notice;
set client_min_messages = notice;
SQL
  for mode in custom generic; do
    if [ "$mode" = "generic" ]; then echo "set plan_cache_mode = force_generic_plan;"; fi
    echo "do \$\$ begin raise notice 'MARK ${mode}_no_comments'; end \$\$;"
    echo "begin; update public.tasks set client_scope = 'internal' where id = '$T_NOC'; rollback;"
    echo "do \$\$ begin raise notice 'MARK ${mode}_with_comments'; end \$\$;"
    echo "begin; update public.tasks set client_scope = 'internal' where id = '$T_WC'; rollback;"
    echo "do \$\$ begin raise notice 'MARK ${mode}_visibility'; end \$\$;"
    echo "begin; update public.task_comments set visibility = 'internal' where id = '$C_WC'; rollback;"
    echo "do \$\$ begin raise notice 'MARK ${mode}_fallback_task'; end \$\$;"
    echo "begin; $BREAK_JUDGE update public.tasks set client_scope = 'internal' where id = '$T_WC'; rollback;"
    echo "do \$\$ begin raise notice 'MARK ${mode}_fallback_visibility'; end \$\$;"
    echo "begin; $BREAK_JUDGE update public.task_comments set visibility = 'internal' where id = '$C_WC'; rollback;"
  done
} > "$WORK/perf_plans.sql"
psql "$(conn perf)" -q -v ON_ERROR_STOP=1 -f "$WORK/perf_plans.sql" > "$PERF_OUT" 2>&1

# auto_explain の出力を「種類<TAB>計画を1行にしたもの」にする（$2 の区切りの中だけ）。
# psql -f はメッセージの頭に「psql:<ファイル>:<行>: 」を付けるので、先に外す
perf_blocks(){
  awk -v want="$2" '
    # 判定を使う削除と、判定を使わない削除（後備え）は、補助関数の名前があるかで分ける
    function kind(b) {
      if (b ~ /delete from public\.notifications n[[:space:]]+using public\.task_comments c/)
        return (b ~ /app_task_comment_visible_to_user/) ? "task_delete" : "task_fallback_delete"
      if (b ~ /exists \(select 1 from public\.task_comments c where c\.task_id = new\.id\)/) return "task_exists"
      if (b ~ /dedupe_key = format\(/)
        return (b ~ /app_task_comment_visible_to_user/) ? "comment_delete" : "comment_fallback_delete"
      return "other"
    }
    function flush() {
      if (inblk && sec == want) { gsub(/\t/, " ", blk); print kind(blk) "\t" blk }
      inblk = 0; blk = ""
    }
    { sub(/^psql:[^[:space:]]*:[0-9]+: /, "") }
    /^NOTICE:  MARK / { flush(); sec = $3; next }
    /^(NOTICE|WARNING|ERROR|DETAIL|CONTEXT|HINT):/ { flush() }
    /^NOTICE:  duration:/ { inblk = 1; blk = ""; next }
    inblk { blk = blk " " $0 }
    END { flush() }
  ' "$1"
}
# $1 = label, $2 = 区切り, $3 = 種類, $4… = 計画に含まれるべき索引
perf_check(){
  local label="$1" sec="$2" k="$3"; shift 3
  local plans; plans="$(perf_blocks "$PERF_OUT" "$sec" | awk -F'\t' -v k="$k" '$1 == k { print $2 }')"
  if [ -z "$plans" ]; then record "FAIL[$label]: no $k plan in $sec"; return; fi
  if printf '%s' "$plans" | grep -q "Seq Scan"; then record "FAIL[$label]: seq scan in $sec"; return; fi
  local ix
  for ix in "$@"; do
    if ! printf '%s' "$plans" | grep -q "$ix"; then record "FAIL[$label]: $ix not used in $sec"; return; fi
  done
  record "PASS[$label]: $*"
}
if grep -q "ERROR" "$PERF_OUT"; then
  record "FAIL[perf_run]: $(grep -m1 ERROR "$PERF_OUT")"
else
  for mode in custom generic; do
    perf_check "perf_${mode}_no_comment_task_exists_uses_index" "${mode}_no_comments" task_exists idx_task_comments_task_id
    if perf_blocks "$PERF_OUT" "${mode}_no_comments" | grep -q '^task_delete'; then
      record "FAIL[perf_${mode}_no_comment_task_skips_delete]: delete ran"
    else
      record "PASS[perf_${mode}_no_comment_task_skips_delete]: no delete"
    fi
    perf_check "perf_${mode}_task_delete_uses_indexes" "${mode}_with_comments" task_delete \
      idx_task_comments_task_id notifications_task_comment_dedupe_idx
    perf_check "perf_${mode}_visibility_delete_uses_index" "${mode}_visibility" comment_delete \
      notifications_task_comment_dedupe_idx
    perf_check "perf_${mode}_task_fallback_delete_uses_indexes" "${mode}_fallback_task" task_fallback_delete \
      idx_task_comments_task_id notifications_task_comment_dedupe_idx
    perf_check "perf_${mode}_visibility_fallback_delete_uses_index" "${mode}_fallback_visibility" comment_fallback_delete \
      notifications_task_comment_dedupe_idx
  done
fi

# トリガーの時間（5回流した最後の値。1回目は計画づくりを含むため）
trigger_time(){  # $1 = update 文
  local sql="$WORK/perf_time.sql"
  : > "$sql"
  for i in 1 2 3 4 5; do
    echo "begin; explain (analyze, costs off, summary off) $1; rollback;" >> "$sql"
  done
  # トリガーが動かなければ行が無い（grep が 1 を返しても止めない。空の文字列を返す）
  psql "$(conn perf)" -qtA -v ON_ERROR_STOP=1 -f "$sql" 2>&1 | grep -E "Trigger (tasks_retract_comment_notice_on_scope_change|task_comments_retract_on_visibility_change):" | tail -1 || true
}
TT_NOC="$(trigger_time "update public.tasks set client_scope = 'internal' where id = '$T_NOC'")"
# ボールの受け渡しでは、トリガーが動かない（explain analyze の「Trigger 名前:」は、動いたトリガーだけに出る）
TT_BALL="$(trigger_time "update public.tasks set ball = 'client' where id = '$T_WC'")"
if [ -z "$TT_BALL" ]; then
  record "PASS[perf_ball_change_skips_trigger]: not fired"
else
  record "FAIL[perf_ball_change_skips_trigger]: $TT_BALL"
fi
TT_WC="$(trigger_time "update public.tasks set client_scope = 'internal' where id = '$T_WC'")"
TT_VIS="$(trigger_time "update public.task_comments set visibility = 'internal' where id = '$C_WC'")"

echo ""
sed 's/^/  /' "$RES"
echo ""
echo "  perf data: $PERF_ROWS"
echo "  trigger time (no comments, scope change):     ${TT_NOC:-(none)}"
echo "  trigger time (10 comments / 40 notices):      ${TT_WC:-(none)}"
echo "  trigger time (comment visibility change):     ${TT_VIS:-(none)}"
if [ -n "${CRN_SHOW_PLANS:-}" ]; then
  for sec in custom_no_comments custom_with_comments custom_visibility custom_fallback_task custom_fallback_visibility \
             generic_no_comments generic_with_comments generic_visibility generic_fallback_task generic_fallback_visibility; do
    echo "  -- plans: $sec"
    perf_blocks "$PERF_OUT" "$sec" | awk -F'\t' '$1 != "other" { print "    " $1 ": " substr($2, 1, 900) }'
  done
fi
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ] || [ "$NPASS" -eq 0 ]; then
  echo "COMMENT NOTIFY RETRACT ON NARROW CHECKS FAILED"; exit 1
fi
echo "COMMENT NOTIFY RETRACT ON NARROW CHECKS PASSED"
