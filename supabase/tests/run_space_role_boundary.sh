#!/usr/bin/env bash
# =============================================================================
# space の役割ごとの権限（*_space_role_boundary.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役:
# 既定の権限・auth.uid()・service_role の bypassrls）を足す。migration は1行も変えない。
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      space_role_boundary_assert.sql（人物ごとの見え方・書き込み・RPC・トリガー・形）
# 続けて RED=1 でないときだけ:
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  各節の末尾のロールバック節を後ろの節から流すと、本 migration の前のスキーマ（表・列・列の権限・
#               ポリシー・関数・トリガー・制約・表の権限・索引）と見え方になる → そのあと再適用できる
#   guard_*     本 migration の確認が効く: RPC の今の定義が土台と違う／meetings の表の select が別の付与者から
#               付いている、のどちらでも適用が止まり、何も変わらない（本 migration の前の複製で）
#
# assert の label:
#   chg_*   本 migration で定める規則
#   same_*  本 migration で変えない規則
#
# 使い方:
#   bash supabase/tests/run_space_role_boundary.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_space_role_boundary.sh    # 本 migration を流さずに同じ assert を回し、
#       chg_* / same_* の区分けが合っていることを確かめる（テスト自体の確かめ）
# 必要: PostgreSQL 17（initdb / pg_ctl / psql / createdb）。場所は PGBIN で変えられる。
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [ -x "$PGBIN/psql" ]; then export PATH="$PGBIN:$PATH"; fi

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"
RED="${RED:-0}"

shopt -s nullglob
targets=("$MIG"/*_space_role_boundary.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
TARGET="${targets[0]}"

WORK="$(mktemp -d /tmp/srb.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54449
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
# 「drop ... if exists」の NOTICE は出さない（WARNING 以上とエラーは出す）
apply(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -1 -f "$2" >/dev/null; }
apply_plain(){ PGOPTIONS='--client-min-messages=warning' psql "$(conn "$1")" -q -v ON_ERROR_STOP=1 -f "$2" >/dev/null; }
# 1つの値を返す問い合わせ（postgres で）
q(){ psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 -c "$2"; }

RES="$WORK/results.txt"; : > "$RES"
record(){ echo "$1" >> "$RES"; }

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない。
#   権限（aclitem の並び）は付けた順で並びが変わるので、並べ替えてから比べる。関数は SECURITY DEFINER・search_path・本体の md5 も見る。
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
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
) s order by x;
SQL
}

# 指定した利用者（authenticated・request.jwt.claims の sub）で SQL を流し、最後の1行（結果、または ERROR の行）を返す
as_user(){
  { psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$2","role":"authenticated"}', true) is not null;
$3
rollback;
SQL
  } | tail -1
}

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

echo "== checks: space_role_boundary_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/space_role_boundary_assert.sql" > "$OUT" 2>&1
set -e
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# 集計の例外以外の ERROR はハーネスかテストデータの不備（どちらのモードでも失敗扱い）
if grep "ERROR" "$OUT" | grep -qv "SPACE ROLE BOUNDARY CHECKS FAILED"; then
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

U_CLI='00000000-0000-0000-0000-00000000c003'
U_VW='00000000-0000-0000-0000-00000000c002'
# ロールバックのあとと再適用のあとで、同じ問い合わせの結果を比べる
CLI_PLANNED="select count(*) from public.meetings where id = '00000000-0000-0000-0000-000000004001';"
VW_UPDATE="with u as (update public.tasks set title = title where id = '00000000-0000-0000-0000-00000000d001' returning 1) select count(*) from u;"

echo "== re-apply with data present =="
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi

echo "== rollback sections (last section first) =="
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
# ロールバックの SQL がある節は 1〜9（節 10 は確かめるだけ）
if [ "$NBLK" -eq 9 ]; then
  record "PASS[rollback_sections_found]: $NBLK sections, $NSTMT statements"
else
  record "FAIL[rollback_sections_found]: $NBLK sections (want 9)"
fi
if PGOPTIONS='--client-min-messages=warning' psql "$(conn checks)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback.out" 2>&1; then
  record "PASS[rollback_applies]: ok"
  fingerprint checks > "$WORK/fp_after_rollback.txt"
  if diff -u "$WORK/fp_before.txt" "$WORK/fp_after_rollback.txt" > "$WORK/fp.diff"; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: schema differs from pre-migration"
    head -60 "$WORK/fp.diff"
  fi
  N="$(as_user checks "$U_CLI" "$CLI_PLANNED")"
  if [ "$N" = "1" ]; then record "PASS[rollback_restores_client_planned_meeting]: $N"; else record "FAIL[rollback_restores_client_planned_meeting]: got ${N:-<none>}, want 1"; fi
  N="$(as_user checks "$U_VW" "$VW_UPDATE")"
  if [ "$N" = "1" ]; then record "PASS[rollback_restores_viewer_task_update]: $N"; else record "FAIL[rollback_restores_viewer_task_update]: got ${N:-<none>}, want 1"; fi
  if apply checks "$TARGET"; then record "PASS[reapply_after_rollback]: ok"; else record "FAIL[reapply_after_rollback]: apply failed"; fi
  N="$(as_user checks "$U_CLI" "$CLI_PLANNED")"
  if [ "$N" = "0" ]; then record "PASS[reapply_after_rollback_client_planned_meeting]: $N"; else record "FAIL[reapply_after_rollback_client_planned_meeting]: got ${N:-<none>}, want 0"; fi
  N="$(as_user checks "$U_VW" "$VW_UPDATE")"
  if [ "$N" = "0" ]; then record "PASS[reapply_after_rollback_viewer_task_update]: $N"; else record "FAIL[reapply_after_rollback_viewer_task_update]: got ${N:-<none>}, want 0"; fi
else
  record "FAIL[rollback_applies]: rollback sections failed"
  head -20 "$WORK/rollback.out"
fi

echo "== guards: the migration stops (and changes nothing) =="
# 止まったあとの状態: 役割を見る関数が無く、meetings の読み取りのポリシーと notes の権限が本 migration の前のまま
unchanged_state(){ echo "helpers=$(q "$1" "select count(*) from pg_proc where proname in ('app_space_role_of_caller', 'app_is_space_internal', 'app_can_write_space', 'app_can_write_wiki_page')"),meetings_select=$(q "$1" "select qual from pg_policies where schemaname = 'public' and tablename = 'meetings' and policyname = 'meetings_select_member'"),notes_select=$(q "$1" "select has_column_privilege('authenticated', 'public.meetings', 'notes', 'select')")"; }
WANT_STATE='helpers=0,meetings_select=app_can_access_space(space_id, org_id),notes_select=t'

# (1) RPC の今の定義が土台と違えば止まる（本番だけの手直しを上書きしない）
newdb -T pre guard_rpc
psql "$(conn guard_rpc)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v text;
begin
  v := pg_get_functiondef('public.rpc_meeting_start(uuid)'::regprocedure);
  v := replace(v, 'Meeting not found: %', 'Meeting not found (local fix): %');
  execute v;
end $$;
SQL
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_rpc)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_rpc.out" 2>&1; then
  record "FAIL[guard_rpc_definition_drift_blocks]: applied although rpc_meeting_start differed from its base"
else
  S="$(unchanged_state guard_rpc)"
  FIX="$(q guard_rpc "select (prosrc like '%local fix%')::text from pg_proc where oid = 'public.rpc_meeting_start(uuid)'::regprocedure")"
  if [ "$S" = "$WANT_STATE" ] && [ "$FIX" = "true" ] && grep -q "rpc_meeting_start(uuid)" "$WORK/guard_rpc.out"; then
    record "PASS[guard_rpc_definition_drift_blocks]: stopped, nothing changed ($S, local fix kept)"
  else
    record "FAIL[guard_rpc_definition_drift_blocks]: stopped but got $S, local fix=$FIX"; cat "$WORK/guard_rpc.out"
  fi
fi

# (2) meetings の表の select が別の付与者から付いていて notes を隠せないときも止まる
newdb -T pre guard_notes
psql "$(conn guard_notes)" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'srb_other_grantor') then create role srb_other_grantor nologin; end if; end $$;
grant select on public.meetings to srb_other_grantor with grant option;
set role srb_other_grantor;
grant select on public.meetings to authenticated;
reset role;
SQL
if PGOPTIONS='--client-min-messages=warning' psql "$(conn guard_notes)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/guard_notes.out" 2>&1; then
  record "FAIL[guard_meetings_notes_grant_blocks]: applied although authenticated could read meetings.notes"
else
  S="$(unchanged_state guard_notes)"
  if [ "$S" = "$WANT_STATE" ] && grep -q "meetings の列ごとの権限" "$WORK/guard_notes.out"; then
    record "PASS[guard_meetings_notes_grant_blocks]: stopped, nothing changed ($S)"
  else
    record "FAIL[guard_meetings_notes_grant_blocks]: stopped but got $S"; cat "$WORK/guard_notes.out"
  fi
fi

# (3)〜(5) space と組織・マイルストーン・元のページが食い違う行があれば止まる（節 0）
guard_mismatch(){
  local name="$1" want_text="$2" setup="$3"
  newdb -T pre "$name"
  printf '%s\n' "$GUARD_BASE" "$setup" | psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 >/dev/null
  if PGOPTIONS='--client-min-messages=warning' psql "$(conn "$name")" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" > "$WORK/$name.out" 2>&1; then
    record "FAIL[$name]: applied although a mismatched row existed"
  else
    S="$(unchanged_state "$name")"
    if [ "$S" = "$WANT_STATE" ] && grep -qF "$want_text" "$WORK/$name.out"; then
      record "PASS[$name]: stopped, nothing changed ($S)"
    else
      record "FAIL[$name]: stopped but got $S"; cat "$WORK/$name.out"
    fi
  fi
}
GUARD_BASE="
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1');
insert into public.organizations(id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'a'), ('00000000-0000-0000-0000-0000000000a2', 'b');
insert into public.spaces(id, org_id, type, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'project', 'sa1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'project', 'sa2');
"
guard_mismatch guard_space_org_mismatch_blocks 'tasks(space と組織)=1' "
insert into public.tasks(org_id, space_id, title, status, created_by) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 't', 'todo', '00000000-0000-0000-0000-0000000000f1');
"
guard_mismatch guard_milestone_space_mismatch_blocks 'meetings(マイルストーン)=1' "
insert into public.milestones(id, org_id, space_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'm');
insert into public.meetings(org_id, space_id, milestone_id, title, held_at, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'mt', now(), '00000000-0000-0000-0000-0000000000f1');
"
guard_mismatch guard_wiki_publication_mismatch_blocks 'wiki_page_publications(マイルストーン・元のページ)=1' "
insert into public.milestones(id, org_id, space_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'm');
insert into public.milestone_publications(org_id, milestone_id, is_published, published_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', true, '00000000-0000-0000-0000-0000000000f1');
insert into public.wiki_pages(id, org_id, space_id, title, created_by, updated_by) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2',
   'w', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1');
insert into public.wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1',
   't', 'b', '00000000-0000-0000-0000-0000000000f1');
"

sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"

if [ "$NFAIL" -ne 0 ] || ! grep -q "SPACE ROLE BOUNDARY CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL SPACE ROLE BOUNDARY CHECKS PASSED (on real migrations)"
