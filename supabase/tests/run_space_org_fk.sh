#!/usr/bin/env bash
# =============================================================================
# space 単位の表の行は、同じ組織の space だけを指す（*_space_org_fk.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役）を足す。
# migration は1行も変えない。そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      space_org_fk_assert.sql（12 表の書き込み・space を消したときの行・外部キーの形）
# 続けて RED=1 でないときだけ:
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を流すと、本 migration の前のスキーマになる → そのあと再適用できる
#   guard_*     space と組織が食い違う行があると、適用が止まり、何も変わらない（本 migration の前の複製で）
#
# assert の label:
#   chg_*   本 migration で定める規則
#   same_*  本 migration で変えない規則
#
# 使い方:
#   bash supabase/tests/run_space_org_fk.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_space_org_fk.sh    # 本 migration を流さずに同じ assert を回し、
#       chg_* / same_* の区分けが合っていることを確かめる（テスト自体の確かめ）
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
#   使い捨てクラスタは1つだけ起動し、終わると必ず止めて消す。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

shopt -s nullglob
targets=("$MIG"/*_space_org_fk.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"

WORK="$(mktemp -d /tmp/sofk.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54451
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
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

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
  select 'trg ' || t.tgrelid::regclass::text || ' ' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
    from pg_trigger t where not t.tgisinternal
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || convalidated::text || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

# 組織 O2 の org_id で、組織 O1 の space（S1）を指す tasks の行を入れてみる（巻き戻す）。出力を1行につなげて返す
MISMATCH_PROBE="begin;
insert into public.tasks(org_id, space_id, title, status, created_by)
  values ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000b001', 'probe', 'todo',
          '00000000-0000-0000-0000-00000000c001') returning 'inserted';
rollback;"
probe(){ { psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 2>&1 <<<"$MISMATCH_PROBE" || true; } | grep -v '^$' | tr '\n' ' '; }

echo "== bootstrap + Supabase の権限の代役 =="
newdb base
apply_plain base "$TST/_local_bootstrap.sql"
apply base "$TST/harness/space_role_boundary_setup.sql"

echo "== prior migrations (verbatim, same order as verify-migrations-from-scratch.sh, up to the target) =="
n=0
for f in $(ls "$MIG"/*.sql | sort); do
  [ "$f" = "$TARGET" ] && break
  if ! apply_plain base "$f" 2>"$WORK/mig_err.txt"; then
    echo "failed: $(basename "$f")"; head -20 "$WORK/mig_err.txt"; exit 1
  fi
  n=$((n + 1))
done
echo "   applied $n migrations"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  # 本 migration の前の状態を残しておく（guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base checks

echo "== checks: space_org_fk_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/space_org_fk_assert.sql" > "$OUT" 2>&1
set -e
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# 集計の例外以外の ERROR はハーネスかテストデータの不備（どちらのモードでも失敗扱い）
if grep "ERROR" "$OUT" | grep -qv "SPACE ORG FK CHECKS FAILED"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

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
    echo "RED MISMATCH: chg_* held without the migration (the assert does not detect the rule):"
    printf '  %s\n' $BAD_PASS; exit 1
  fi
  if [ "$NFAIL" -eq 0 ]; then
    echo "RED NOT REPRODUCED: every assert held without the migration"; exit 1
  fi
  echo ""
  echo "RED CONFIRMED: without the migration, all $NFAIL chg_* assert(s) do not hold and all $NPASS same_* assert(s) hold"
  exit 0
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
# ロールバックの SQL がある節は 1 だけ（節 0 は確かめるだけ）
if [ "$NBLK" -eq 1 ] && [ "$NSTMT" -eq 12 ]; then
  record "PASS[rollback_sections_found]: $NBLK section, $NSTMT statements"
else
  record "FAIL[rollback_sections_found]: $NBLK sections, $NSTMT statements (want 1 section, 12 statements)"
fi
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -40 "$WORK/fp.diff"
  fi
  P="$(probe checks)"
  if printf '%s' "$P" | grep -q 'inserted' && ! printf '%s' "$P" | grep -q 'ERROR'; then record "PASS[rollback_restores_mismatch_insert]: inserted"; else record "FAIL[rollback_restores_mismatch_insert]: got ${P:-<none>}, want inserted"; fi
  if apply checks "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  P="$(probe checks)"
  if printf '%s' "$P" | grep -q 'tasks_space_org_fkey'; then record "PASS[reapply_after_rollback_mismatch_insert]: stopped by tasks_space_org_fkey"; else record "FAIL[reapply_after_rollback_mismatch_insert]: got ${P:-<none>}"; fi
else
  record "FAIL[rollback_applies]: rollback section failed"
  head -20 "$WORK/rollback.out"
fi

echo "== guards: the migration stops (and changes nothing) when a row points at a space of another org =="
# 止まったあとの状態: 本 migration の外部キーが1つも無い
unchanged_state(){ echo "space_org_fkeys=$(q "$1" "select count(*) from pg_constraint where conname like '%\_space\_org\_fkey' and contype = 'f' and conrelid::regclass::text not like 'channel\_%'")"; }
GUARD_BASE="
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1');
set role service_role;
insert into public.organizations(id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'a'), ('00000000-0000-0000-0000-0000000000a2', 'b');
insert into public.spaces(id, org_id, type, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'project', 'sa');
"
guard_mismatch(){
  local name="$1" want_text="$2" setup="$3"
  newdb -T pre "$name"
  printf '%s\n' "$GUARD_BASE" "$setup" | psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 >/dev/null
  if PGOPTIONS='--client-min-messages=warning' psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/$name.out" 2>&1; then
    record "FAIL[$name]: applied although a mismatched row existed"
  else
    S="$(unchanged_state "$name")"
    if [ "$S" = "space_org_fkeys=0" ] && grep -qF "$want_text" "$WORK/$name.out"; then
      record "PASS[$name]: stopped, nothing changed ($S)"
    else
      record "FAIL[$name]: stopped but got $S"; cat "$WORK/$name.out"
    fi
  fi
}
guard_mismatch guard_tasks_mismatch_blocks 'tasks=1' "
insert into public.tasks(org_id, space_id, title, status, created_by) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 't', 'todo', '00000000-0000-0000-0000-0000000000f1');
"
guard_mismatch guard_task_pricing_mismatch_blocks 'task_pricing=1' "
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   't', 'todo', '00000000-0000-0000-0000-0000000000f1');
insert into public.task_pricing(org_id, space_id, task_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1');
"

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "SPACE ORG FK CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL SPACE ORG FK CHECKS PASSED (on real migrations)"
