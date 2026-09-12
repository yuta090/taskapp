#!/usr/bin/env bash
# =============================================================================
# 社内専用の記録を新しい表だけに置く（*_internal_metrics_drop_old_columns.sql・C3）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/space_role_boundary_setup.sql      表・関数・シーケンスの既定の権限・auth.uid()（request.jwt.claims）・service_role の bypassrls
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権
# 本 migration の前に internal_metrics_drop_old_columns_seed.sql（古い列に値の入った行）を入れる。
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      internal_metrics_drop_old_columns_assert.sql（古い列・つなぎ・見張り・新しい表・代理店モードの見張り）
# 続けて GREEN のときだけ:
#   scope_*     消えるのは古い3列とその CHECK・つなぎのトリガーと関数で、変わるのは見張りの本文とトリガーだけ
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を流すと、適用前のスキーマと挙動に戻る → 戻したあと再適用できる
#   parity_*    流す前の DB の複製で、古い列と新しい表の値を3つとも食い違わせて流すと、節 0 が3つの文言で止まり、
#               何も変わらない（古い列が残る）
#   seed_*      C3 を流した DB で、supabase/seed_agency_test.sql が postgres のまま（SQL エディタと同じ）最後まで通る
#               （SEED_AGENCY_FILE=<file> で別の版の seed を流せる）
#   lock_*      ロックを取る文が、表を変える文より先にある（ファイルの並び）。本 migration を流した（初回と2回目の）
#               トランザクションの最後に、同じ接続が AccessExclusiveLock を持っている表が tasks・spaces だけ
#               （先頭で押さえた表だけ。pg_locks・pg_backend_pid()）
#
# assert の label:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  本 migration で変えないもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_internal_metrics_drop_old_columns.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_internal_metrics_drop_old_columns.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#   TARGET_FILE=<file> bash supabase/tests/run_internal_metrics_drop_old_columns.sh
#       本 migration の位置で別の版を流す（検査が効くことを確かめる用）
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
#   使い捨てクラスタは1つだけ起動し、終わると必ず止めて消す。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
SEED="$TST/internal_metrics_drop_old_columns_seed.sql"
ASSERT="$TST/internal_metrics_drop_old_columns_assert.sql"
RED="${RED:-0}"
# 消える物（古い3列・その CHECK・つなぎのトリガーと関数）と、変わる物（見張りの本文とトリガー）
NEW_RE='guard_agency_settings'
CHANGED_RE='^col tasks\.actual_hours |^col spaces\.(default_margin_rate|vendor_settings) |^con spaces chk_(default_margin_rate|vendor_settings) |bridge_task_actual_hours|bridge_space_agency_settings|guard_agency_settings'
WANT_ADDED=2
WANT_REMOVED=11
# ロールバック節の数と、; で終わる行の数（節 1〜3。関数の本文の行も数える）
WANT_RB_BLOCKS=3
WANT_RB_STMTS=43

shopt -s nullglob
targets=("$MIG"/*_internal_metrics_drop_old_columns.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
# REAL_TARGET: supabase/migrations の中の本 migration（ここまでの migrations を流す区切り）
# TARGET: 実際に流す版（TARGET_FILE で差し替えられる）
REAL_TARGET="${targets[0]}"
TARGET="${TARGET_FILE:-$REAL_TARGET}"
[ -f "$TARGET" ] || { echo "TARGET_FILE not found: $TARGET"; exit 1; }

WORK="$(mktemp -d /tmp/c3d.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54464
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

# 本 migration・確認用の SQL は1トランザクションで流す（apply-migration.sh --commit と同じ）。
# それより前の migrations は verify-migrations-from-scratch.sh と同じく、トランザクションで包まずに流す。
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }

# 本 migration を1トランザクションで流し、同じトランザクションの最後に、この接続が持っている表のロックを出す
#   （public のすべての表。1行 = 表=ロックの種類+…）
apply_with_lock_probe(){
  local w="$WORK/lock_probe_$(basename "$3")"
  { printf '%s\n' "\\i '$2'"
    cat <<'SQL'
select c.relname || '=' || string_agg(l.mode, '+' order by l.mode)
  from pg_locks l join pg_class c on c.oid = l.relation
 where l.pid = pg_backend_pid() and l.locktype = 'relation' and l.granted
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
 group by c.relname
 order by c.relname;
SQL
  } > "$w"
  PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -tA -v ON_ERROR_STOP=1 -1 -f "$w" > "$3"
}

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない。
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select x from (
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
         || ' rls=' || c.relrowsecurity::text as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'idx ' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'colacl ' || c.relname || '.' || a.attname || ' '
         || (select string_agg(ai::text, ',' order by ai::text) from unnest(a.attacl) ai)
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and a.attacl is not null and cardinality(a.attacl) > 0
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
         || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all
  select 'fn ' || p.oid::regprocedure::text || ' definer=' || p.prosecdef::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '')
         || ' acl=' || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(p.proacl) ai), '')
         || ' ' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid)
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || convalidated::text || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "DROP OLD COLUMNS CHECKS FAILED"; then
    echo "HARNESS ERROR ($1):"; grep -B2 -A3 "ERROR" "$2" | head -40; exit 1
  fi
}

# assert の結果の形: all_pass（全 PASS）/ red（chg_* が全て FAIL・same_* が全て PASS）/ mixed（それ以外。理由つき）
shape(){
  local labels passes fails np nf badf badp
  labels="$(grep -oE '(PASS|FAIL)\[[a-z0-9_]+\]' "$1" || true)"
  passes="$(printf '%s\n' "$labels" | sed -nE 's/^PASS\[(.*)\]$/\1/p' | sort -u)"
  fails="$(printf '%s\n' "$labels" | sed -nE 's/^FAIL\[(.*)\]$/\1/p' | sort -u)"
  np="$(printf '%s\n' "$passes" | grep -c . || true)"
  nf="$(printf '%s\n' "$fails" | grep -c . || true)"
  if [ "$nf" -eq 0 ] && [ "$np" -gt 0 ]; then echo "all_pass: $np passed"; return; fi
  badf="$(printf '%s\n' "$fails" | grep -v '^$' | grep -v '^chg_' || true)"
  badp="$(printf '%s\n' "$passes" | grep '^chg_' || true)"
  if [ -z "$badf" ] && [ -z "$badp" ] && [ "$nf" -gt 0 ]; then
    echo "red: $nf chg_* failed, $np same_* passed"; return
  fi
  echo "mixed: same_* failed=[$(echo $badf)] chg_* passed=[$(echo $badp)]"
}

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"
apply base "$TST/harness/supabase_function_default_acl.sql"

echo "== prior migrations (verbatim, same order as verify-migrations-from-scratch.sh, up to the target) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  [ "$f" = "$REAL_TARGET" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

echo "== seed (rows that already exist, before the target) =="
apply base "$SEED"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent; locks read at the end of each apply): $(basename "$TARGET") =="
  apply_with_lock_probe base "$TARGET" "$WORK/locks_first.txt"
  apply_with_lock_probe base "$TARGET" "$WORK/locks_second.txt"
  fingerprint base > "$WORK/fp_after.txt"
fi

newdb -T base checks

echo "== checks: internal_metrics_drop_old_columns_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

if [ "$RED" = "1" ]; then
  sed 's/^/  /' "$RES"
  echo "PASS: $(grep -c '^PASS\[' "$RES" || true)  FAIL: $(grep -c '^FAIL\[' "$RES" || true)"
  S="$(shape "$OUT")"
  case "$S" in
    red:*) echo ""; echo "RED CONFIRMED: $S (without the migration)"; exit 0 ;;
    *)     echo "RED MISMATCH: $S"; exit 1 ;;
  esac
fi

echo "== scope: old columns, their checks and the bridges are removed; only the guard changes =="
REMOVED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^< //p' || true)"
ADDED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^> //p' || true)"
OUT_ADDED="$(printf '%s\n' "$ADDED" | grep -v '^$' | grep -vE "$NEW_RE" || true)"
OUT_REMOVED="$(printf '%s\n' "$REMOVED" | grep -v '^$' | grep -vE "$CHANGED_RE" || true)"
NADD="$(printf '%s\n' "$ADDED" | grep -c . || true)"
NREM="$(printf '%s\n' "$REMOVED" | grep -c . || true)"
if [ -z "$OUT_ADDED" ] && [ -z "$OUT_REMOVED" ] && [ "$NADD" -eq "$WANT_ADDED" ] && [ "$NREM" -eq "$WANT_REMOVED" ]; then
  record "PASS[scope_only_intended_objects]: $NREM lines removed or replaced, $NADD lines added (guard), nothing else changed"
else
  record "FAIL[scope_only_intended_objects]: added $NADD (want $WANT_ADDED), removed $NREM (want $WANT_REMOVED); other added: $(printf '%s' "$OUT_ADDED" | head -3 | tr '\n' ';') other removed: $(printf '%s' "$OUT_REMOVED" | head -3 | tr '\n' ';')"
fi

echo "== locks: the lock statement comes first; AccessExclusiveLock only on tasks / spaces at the end of each apply =="
LOCK_LINE="$(grep -nE 'lock table public\.tasks, public\.spaces in access exclusive mode' "$TARGET" | head -1 | cut -d: -f1)"
FIRST_DDL="$(grep -nE '^[[:space:]]*(drop|alter|create|comment)[[:space:]]' "$TARGET" | head -1 | cut -d: -f1)"
if [ -n "$LOCK_LINE" ] && [ -n "$FIRST_DDL" ] && [ "$LOCK_LINE" -lt "$FIRST_DDL" ]; then
  record "PASS[lock_statement_first]: lock at line $LOCK_LINE, first change at line $FIRST_DDL"
else
  record "FAIL[lock_statement_first]: lock line=${LOCK_LINE:-none}, first change line=${FIRST_DDL:-none}"
fi
for k in first second; do
  AE="$(grep 'AccessExclusiveLock' "$WORK/locks_$k.txt" | cut -d= -f1 | sort | tr '\n' ',' | sed 's/,$//')"
  NOTHER="$(grep -vc 'AccessExclusiveLock' "$WORK/locks_$k.txt" || true)"
  if [ "$AE" = "spaces,tasks" ]; then
    record "PASS[lock_${k}_apply_access_exclusive_only_on_tasks_spaces]: AccessExclusiveLock on $AE; $NOTHER other tables with weaker locks"
  else
    record "FAIL[lock_${k}_apply_access_exclusive_only_on_tasks_spaces]: AccessExclusiveLock on ${AE:-none} ($(tr '\n' ' ' < "$WORK/locks_$k.txt"))"
  fi
done

echo "== parity check in section 0: stops with clear messages when the old columns and the new tables differ =="
psql "$(conn pre)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.task_internal_metrics set actual_hours = 9 where task_id = '00000000-0000-0000-0000-00000000d001';
update public.space_agency_settings
   set default_margin_rate = 25, vendor_settings = '{"show_client_name": false, "allow_client_comments": false}'
 where space_id = '00000000-0000-0000-0000-00000000b001';
SQL
set +e
OUT_P="$(PGOPTIONS='--client-min-messages=warning' psql "$(conn pre)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" 2>&1)"
RC_P=$?
set -e
COLS_P="$(psql "$(conn pre)" -qtA -c "select count(*) from pg_attribute where attrelid in ('public.tasks'::regclass, 'public.spaces'::regclass) and attname in ('actual_hours', 'default_margin_rate', 'vendor_settings') and not attisdropped")"
if [ "$RC_P" -ne 0 ] \
   && printf '%s' "$OUT_P" | grep -q '実績工数（actual_hours）が違う行=1' \
   && printf '%s' "$OUT_P" | grep -q '既定の利益率（default_margin_rate）が違う行=1' \
   && printf '%s' "$OUT_P" | grep -q '協力会社向けの表示設定（vendor_settings）が違う行=1' \
   && [ "$COLS_P" = "3" ]; then
  record "PASS[parity_mismatch_stops_with_clear_messages]: stopped with the 3 messages; the 3 old columns are still there"
else
  record "FAIL[parity_mismatch_stops_with_clear_messages]: rc=$RC_P cols=$COLS_P out=$(printf '%s' "$OUT_P" | grep -m1 ERROR)"
fi

echo "== seed_agency_test.sql on the migrated DB (as postgres, like the SQL editor) =="
SEED_AGENCY="${SEED_AGENCY_FILE:-$REPO/supabase/seed_agency_test.sql}"
newdb -T base sa
# seed の前提: デモ組織・5人（メールで探す）・社内の3人の組織の役割（scripts/seed-test-data.ts が作る形）
psql "$(conn sa)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.organizations(id, name) values ('00000000-0000-0000-0000-000000000001', 'demo');
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'demo@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'staff1@example.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'client1@client.com'),
  ('00000000-0000-0000-0000-0000000000e4', 'vendor1@vendor.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'vendor2@vendor.com');
insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'member'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'client');
SQL
set +e
psql "$(conn sa)" -q -v ON_ERROR_STOP=1 -f "$SEED_AGENCY" > "$WORK/seed_agency.out" 2>&1
RC_SA=$?
set -e
STATE_SA="$(psql "$(conn sa)" -qtA -c "select s.agency_mode::text || ' margin=' || coalesce(a.default_margin_rate::text, '-') || ' members=' || (select count(*) from public.space_memberships m where m.space_id = s.id) || ' tasks=' || (select count(*) from public.tasks t where t.space_id = s.id) || ' pricing=' || (select count(*) from public.task_pricing p where p.space_id = s.id) from public.spaces s left join public.space_agency_settings a on a.space_id = s.id where s.id = 'dddddddd-0000-0000-0000-000000000001'")"
if [ "$RC_SA" -eq 0 ] && [ "$STATE_SA" = "true margin=35.00 members=5 tasks=11 pricing=4" ]; then
  record "PASS[seed_agency_test_runs_after_c3]: $(basename "$SEED_AGENCY") → $STATE_SA"
else
  record "FAIL[seed_agency_test_runs_after_c3]: $(basename "$SEED_AGENCY") rc=$RC_SA state=${STATE_SA:-none} err=$(grep -m1 -E 'ERROR' "$WORK/seed_agency.out" | sed 's/^.*ERROR: *//')"
fi

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback section =="
RBDIR="$WORK/rb"; mkdir -p "$RBDIR"
# 「-- ロールバック（節 N」の見出しから次の「-- ====」までのうち、行頭が「--   」の行だけを SQL として節ごとに取り出す
awk -v dir="$RBDIR" '
  /^-- ロールバック（節 / { s = $0; sub(/^-- ロールバック（節 /, "", s); sub(/[^0-9].*$/, "", s); f = sprintf("%s/%02d.sql", dir, s + 0); next }
  /^-- ====/ { f = ""; next }
  f != "" && /^--   / { line = $0; sub(/^--   /, "", line); print line > f }
' "$TARGET"
RB="$WORK/rollback.sql"; : > "$RB"
NBLK=0
for f in $(ls "$RBDIR"/*.sql 2>/dev/null | sort -r); do
  cat "$f" >> "$RB"; printf '\n' >> "$RB"; NBLK=$((NBLK + 1))
done
NSTMT="$(grep -cE ';[[:space:]]*$' "$RB" || true)"
if [ "$NBLK" -eq "$WANT_RB_BLOCKS" ] && [ "$NSTMT" -eq "$WANT_RB_STMTS" ]; then
  record "PASS[rollback_sections_found]: $NBLK sections, $NSTMT statement lines"
else
  record "FAIL[rollback_sections_found]: $NBLK sections, $NSTMT statement lines (want $WANT_RB_BLOCKS sections, $WANT_RB_STMTS lines)"
fi

# (1) データが入った状態で戻す → 適用前のスキーマと同じ → 再適用すると適用後のスキーマと同じ
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  if apply checks "$TARGET"; then
    record "PASS[reapply_after_rollback]: ok"
    fingerprint checks > "$WORK/fp_after_reapply.txt"
    if diff -u "$WORK/fp_after.txt" "$WORK/fp_after_reapply.txt" > "$WORK/fp2.diff"; then
      record "PASS[reapply_after_rollback_schema]: identical to post-migration"
    else
      record "FAIL[reapply_after_rollback_schema]: schema differs from post-migration"
      head -40 "$WORK/fp2.diff"
    fi
  else
    record "FAIL[reapply_after_rollback]: apply failed"
  fi
else
  record "FAIL[rollback_applies]: rollback section failed"
  head -20 "$WORK/rollback.out"
fi

# (2) 挙動も戻る: 戻した複製で assert を流すと RED と同じ形 → 再適用した複製では全 PASS
newdb -T base rb
if PGOPTIONS='--client-min-messages=warning' psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback_rb.out" 2>&1; then
  newdb -T rb rb_checks
  run_assert rb_checks "$WORK/rb_checks.out"
  S="$(shape "$WORK/rb_checks.out")"
  case "$S" in
    red:*) record "PASS[rollback_restores_behaviour]: $S" ;;
    *)     record "FAIL[rollback_restores_behaviour]: $S" ;;
  esac
  apply rb "$TARGET"
  newdb -T rb rb2_checks
  run_assert rb2_checks "$WORK/rb2_checks.out"
  S="$(shape "$WORK/rb2_checks.out")"
  case "$S" in
    all_pass:*) record "PASS[reapply_after_rollback_behaviour]: $S" ;;
    *)          record "FAIL[reapply_after_rollback_behaviour]: $S" ;;
  esac
else
  record "FAIL[rollback_restores_behaviour]: rollback section failed on a fresh copy"
  head -20 "$WORK/rollback_rb.out"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "DROP OLD COLUMNS CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL DROP OLD COLUMNS CHECKS PASSED (on real migrations)"
