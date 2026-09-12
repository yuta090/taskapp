#!/usr/bin/env bash
# =============================================================================
# 連携の状態と AI 利用の集計のビューはサーバーだけが使う（*_view_privileges_server_only.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/space_role_boundary_setup.sql      表・関数・シーケンスの既定の権限・auth.uid()（request.jwt.claims）・service_role の bypassrls
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権
# 本 migration の前に view_privileges_server_only_seed.sql（Supabase の既定の全権限・既にある行）を入れる。
# そのうえで本 migration を2回適用し、複製で検証する:
#   checks        view_privileges_server_only_assert.sql（security_invoker・表とビューの権限・anon / 運営でないログイン中の人 /
#                 運営 / service_role の読み書き・security_invoker で読む人の RLS が効くこと）
# 続けて GREEN のときだけ:
#   red_*         本 migration の前に、chg_* が全て FAIL・same_* が全て PASS
#   final_check_* 本 migration の末尾の確認（節 4）を適用前の DB で流すと、6つとも「想定と違う」として止まる
#   idempotent_*  2回目の適用で何も変わらない
#   scope_*       変わるのは2つのビューと system_integration_configs の権限（と security_invoker）だけ
#   post_*        適用後の2つのビューと表の権限・security_invoker が、本番で 2026-09-12 に読んだ形と同じ
#   lock_*        流した（初回と2回目の）トランザクションの最後に、この3つ以外の public の物は AccessShareLock だけ
#   reapply_*     データが入った状態で再適用できる
#   rollback_*    ロールバック節を流すと、節に書いた形になり（anon には戻さない・system_integration_status は authenticated の
#                 読むだけ）、ほかは適用前と同じ → 戻したあと再適用すると適用後と同じ・assert も全 PASS
#
# assert の label:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  本 migration で変えないもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_view_privileges_server_only.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_view_privileges_server_only.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#   TARGET_FILE=<file> bash supabase/tests/run_view_privileges_server_only.sh
#       本 migration の位置で別の版を流す（検査が効くことを確かめる用）
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で、ソケットのポート番号は PORT で変えられる。
#   使い捨てクラスタは1つだけ起動し（TCP では待ち受けない）、終わると必ず止めて消す。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
SEED="$TST/view_privileges_server_only_seed.sql"
ASSERT="$TST/view_privileges_server_only_assert.sql"
RED="${RED:-0}"
# 変わる物: 2つのビューと system_integration_configs（rel の行＝権限と security_invoker）
CHANGED_RE='^rel (system_integration_status|app_org_ai_usage_monthly|system_integration_configs) '
WANT_ADDED=3
WANT_REMOVED=3
# ロールバック節の数と、; で終わる行の数（節 1〜3）
WANT_RB_BLOCKS=3
WANT_RB_STMTS=4
# 適用後の形（本番で 2026-09-12 に読んだ形。権限は並べ替え済み）
WANT_POST="$(cat <<'EOF'
app_org_ai_usage_monthly opts={security_invoker=true} acl=postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
system_integration_configs opts=- acl=authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
system_integration_status opts={security_invoker=true} acl=postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
EOF
)"
# ロールバック節を流したあとの形（節に書いたとおり: security_invoker を外す・system_integration_status は authenticated の読むだけ・
#   system_integration_configs は authenticated に全部。anon には戻さない）
WANT_ROLLBACK="$(cat <<'EOF'
app_org_ai_usage_monthly opts=- acl=postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
system_integration_configs opts=- acl=authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
system_integration_status opts=- acl=authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres
EOF
)"

shopt -s nullglob
targets=("$MIG"/*_view_privileges_server_only.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
# REAL_TARGET: supabase/migrations の中の本 migration（ここまでの migrations を流す区切り）
# TARGET: 実際に流す版（TARGET_FILE で差し替えられる）
REAL_TARGET="${targets[0]}"
TARGET="${TARGET_FILE:-$REAL_TARGET}"
[ -f "$TARGET" ] || { echo "TARGET_FILE not found: $TARGET"; exit 1; }

WORK="$(mktemp -d /tmp/vps.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT="${PORT:-54471}"
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

# 本 migration を1トランザクションで流し、同じトランザクションの最後に、この接続が持っている public の物のロックを出す
#   （1行 = 名前=ロックの種類+…）
apply_with_lock_probe(){
  local w="$WORK/lock_probe_$(basename "$3")"
  { printf '%s\n' "\\i '$2'"
    cat <<'SQL'
select c.relname || '=' || string_agg(l.mode, '+' order by l.mode)
  from pg_locks l join pg_class c on c.oid = l.relation
 where l.pid = pg_backend_pid() and l.locktype = 'relation' and l.granted
   and c.relnamespace = 'public'::regnamespace
 group by c.relname
 order by c.relname;
SQL
  } > "$w"
  PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -tA -v ON_ERROR_STOP=1 -1 -f "$w" > "$3"
}

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・ビューの権限と reloptions・列・列ごとの権限・ポリシー・関数・トリガー・制約・索引）。データは含まない。
#   1つの物は1行（条件の中の改行と空白はつめる）。
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select regexp_replace(x, '\s+', ' ', 'g') from (
  select 'rel ' || c.relname || ' ' || c.relkind::text || ' '
         || coalesce((select string_agg(ai::text, ',' order by ai::text) from unnest(c.relacl) ai), '')
         || ' rls=' || c.relrowsecurity::text
         || ' opts=' || coalesce(c.reloptions::text, '') as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'view ' || viewname || ' ' || definition from pg_views where schemaname = 'public'
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
) s order by 1;
SQL
}

# 2つのビューと system_integration_configs の reloptions と権限（並べ替え済み）
three_objects(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select c.relname || ' opts=' || coalesce(c.reloptions::text, '-') || ' acl='
       || coalesce((select string_agg(ai::text, ',' order by ai::text collate "C") from unnest(c.relacl) ai), '-')
  from pg_class c
 where c.oid in ('public.system_integration_status'::regclass, 'public.app_org_ai_usage_monthly'::regclass,
                 'public.system_integration_configs'::regclass)
 order by c.relname;
SQL
}

run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "VIEW PRIVILEGES SERVER ONLY CHECKS FAILED"; then
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

echo "== seed (Supabase default grants and rows that already exist, before the target) =="
apply base "$SEED"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
  newdb -T base checks
  OUT="$WORK/checks.out"
  run_assert checks "$OUT"
  grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true
  sed 's/^/  /' "$RES"
  echo "PASS: $(grep -c '^PASS\[' "$RES" || true)  FAIL: $(grep -c '^FAIL\[' "$RES" || true)"
  S="$(shape "$OUT")"
  case "$S" in
    red:*) echo ""; echo "RED CONFIRMED: $S (without the migration)"; exit 0 ;;
    *)     echo "RED MISMATCH: $S"; exit 1 ;;
  esac
fi

echo "== before the target: assert on a copy (must be red) =="
newdb -T base base_pre
run_assert base_pre "$WORK/base_pre.out"
S="$(shape "$WORK/base_pre.out")"
case "$S" in
  red:*) record "PASS[red_before_the_migration]: $S" ;;
  *)     record "FAIL[red_before_the_migration]: $S" ;;
esac

echo "== the final check (section 4) stops on the state before the migration =="
newdb -T base fc
awk '/^do \$\$/ { f = 1 } f { print } f && /^end \$\$;/ { exit }' "$TARGET" > "$WORK/final_check.sql"
set +e
OUT_FC="$(PGOPTIONS='--client-min-messages=warning' psql "$(conn fc)" -q -v ON_ERROR_STOP=1 -1 -f "$WORK/final_check.sql" 2>&1)"
RC_FC=$?
set -e
NFC="$(printf '%s' "$OUT_FC" | grep -m1 -o '想定と違います:.*' | grep -o ';' | wc -l | tr -d ' ')"
if [ "$RC_FC" -ne 0 ] && [ "$NFC" -eq 6 ]; then
  record "PASS[final_check_stops_before_the_migration]: stopped with $NFC findings"
else
  record "FAIL[final_check_stops_before_the_migration]: rc=$RC_FC findings=$NFC out=$(printf '%s' "$OUT_FC" | head -3 | tr '\n' ';')"
fi

fingerprint base > "$WORK/fp_before.txt"
echo "== target migration (verbatim, applied twice; locks read at the end of each apply): $(basename "$TARGET") =="
if ! apply_with_lock_probe base "$TARGET" "$WORK/locks_first.txt"; then echo "target migration failed (first apply)"; exit 1; fi
fingerprint base > "$WORK/fp_first.txt"
if ! apply_with_lock_probe base "$TARGET" "$WORK/locks_second.txt"; then echo "target migration failed (second apply)"; exit 1; fi
fingerprint base > "$WORK/fp_after.txt"
if diff -q "$WORK/fp_first.txt" "$WORK/fp_after.txt" >/dev/null; then
  record "PASS[idempotent_second_apply_changes_nothing]: identical after the first and the second apply"
else
  record "FAIL[idempotent_second_apply_changes_nothing]: $(diff "$WORK/fp_first.txt" "$WORK/fp_after.txt" | head -4 | tr '\n' ';')"
fi

newdb -T base checks

echo "== checks: view_privileges_server_only_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

echo "== scope: only the two views and system_integration_configs change =="
REMOVED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^< //p' || true)"
ADDED="$(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | sed -nE 's/^> //p' || true)"
OUT_ADDED="$(printf '%s\n' "$ADDED" | grep -v '^$' | grep -vE "$CHANGED_RE" || true)"
OUT_REMOVED="$(printf '%s\n' "$REMOVED" | grep -v '^$' | grep -vE "$CHANGED_RE" || true)"
NADD="$(printf '%s\n' "$ADDED" | grep -c . || true)"
NREM="$(printf '%s\n' "$REMOVED" | grep -c . || true)"
if [ -z "$OUT_ADDED" ] && [ -z "$OUT_REMOVED" ] && [ "$NADD" -eq "$WANT_ADDED" ] && [ "$NREM" -eq "$WANT_REMOVED" ]; then
  record "PASS[scope_only_intended_objects]: $NADD lines added, $NREM lines replaced, nothing else changed"
else
  record "FAIL[scope_only_intended_objects]: added $NADD (want $WANT_ADDED), removed $NREM (want $WANT_REMOVED); other added: $(printf '%s' "$OUT_ADDED" | head -3 | tr '\n' ';') other removed: $(printf '%s' "$OUT_REMOVED" | head -3 | tr '\n' ';')"
fi

echo "== the result matches production =="
GOT="$(three_objects base)"
if [ "$GOT" = "$WANT_POST" ]; then
  record "PASS[post_matches_production]: security_invoker and privileges of the two views and system_integration_configs"
else
  record "FAIL[post_matches_production]: got $(printf '%s' "$GOT" | tr '\n' ';')"
fi

echo "== locks =="
for k in first second; do
  F="$WORK/locks_$k.txt"
  L="$(tr '\n' ' ' < "$F" | sed 's/ *$//')"
  OTHER="$(grep -vE '^(system_integration_status|app_org_ai_usage_monthly|system_integration_configs)=' "$F" | grep -v '^$' | grep -vE '^[^=]+=AccessShareLock$' || true)"
  if [ -z "$OTHER" ]; then
    record "PASS[lock_${k}_apply_no_other_strong_locks]: $L"
  else
    record "FAIL[lock_${k}_apply_no_other_strong_locks]: other strong locks: $(printf '%s' "$OTHER" | tr '\n' ' ')"
  fi
done

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

# データが入った状態で戻す → 節に書いた形・ほかは適用前と同じ → 再適用すると適用後のスキーマと同じ
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  GOT="$(three_objects checks)"
  if [ "$GOT" = "$WANT_ROLLBACK" ]; then
    record "PASS[rollback_state_as_written]: security_invoker reset, system_integration_status readable by authenticated, anon not restored"
  else
    record "FAIL[rollback_state_as_written]: got $(printf '%s' "$GOT" | tr '\n' ';')"
  fi
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  OTHER_RB="$(diff "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" | sed -nE 's/^[<>] //p' | grep -vE "$CHANGED_RE" || true)"
  if [ -z "$OTHER_RB" ]; then
    record "PASS[rollback_touches_only_the_three_objects]: everything else is identical to pre-migration"
  else
    record "FAIL[rollback_touches_only_the_three_objects]: $(printf '%s' "$OTHER_RB" | head -3 | tr '\n' ';')"
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

# 戻して再適用した複製でも、assert は全 PASS
newdb -T base rb
if PGOPTIONS='--client-min-messages=warning' psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback_rb.out" 2>&1; then
  apply rb "$TARGET"
  newdb -T rb rb_checks
  run_assert rb_checks "$WORK/rb_checks.out"
  S="$(shape "$WORK/rb_checks.out")"
  case "$S" in
    all_pass:*) record "PASS[reapply_after_rollback_behaviour]: $S" ;;
    *)          record "FAIL[reapply_after_rollback_behaviour]: $S" ;;
  esac
else
  record "FAIL[reapply_after_rollback_behaviour]: rollback section failed on a fresh copy"
  head -20 "$WORK/rollback_rb.out"
fi

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "VIEW PRIVILEGES SERVER ONLY CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL VIEW PRIVILEGES SERVER ONLY CHECKS PASSED (on real migrations)"
