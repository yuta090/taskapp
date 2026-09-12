#!/usr/bin/env bash
# =============================================================================
# お知らせの既読（*_announcement_reads_privs.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に次の代役を足す（migration は1行も変えない）:
#   harness/space_role_boundary_setup.sql      表・関数・シーケンスの既定の権限・auth.uid()（request.jwt.claims）・service_role の bypassrls
#   harness/supabase_function_default_acl.sql  本番と同じ関数の既定の実行権
# 本 migration の前に announcement_reads_privs_seed.sql（既にある行）を入れる。announcement_reads のポリシーと表の権限は、
# 空の DB から流した形が本番（2026-09-12 に読んだ形）と同じ（base_matches_production で確かめる）。
# そのうえで本 migration を2回適用し（冪等）、複製で検証する:
#   checks      announcement_reads_privs_assert.sql（形・表の権限・anon / 本人 / 他人の行 / 二要素認証 / service_role の読み書き）
# 続けて GREEN のときだけ:
#   red_*       本 migration の前に、chg_* が全て FAIL・same_* が全て PASS
#   scope_*     変わるのは announcement_reads の表の権限と、ポリシーが1つ増えることだけ
#   lock_*      本 migration の最初の文が announcement_reads のロック（lock_timeout 3 秒）／流した（初回と2回目の）トランザクションの
#               最後に、announcement_reads 以外の public の物は AccessShareLock だけ／ほかの接続が announcement_reads を使っていると、
#               3 秒ほどで諦めて何も変えない
#   reapply_*   データが入った状態で再適用できる
#   rollback_*  ロールバック節を流すと、適用前のスキーマと挙動に戻る → 戻したあと再適用できる
#
# assert の label:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  本 migration で変えないもの（両方で PASS）
#
# 使い方:
#   bash supabase/tests/run_announcement_reads_privs.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_announcement_reads_privs.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#   TARGET_FILE=<file> bash supabase/tests/run_announcement_reads_privs.sh
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
SEED="$TST/announcement_reads_privs_seed.sql"
ASSERT="$TST/announcement_reads_privs_assert.sql"
RED="${RED:-0}"
# 本番で 2026-09-12 に読んだ announcement_reads のポリシー（名前|種類|役割|操作|using|with check。空白をつめて public. を外す）と表の権限
PROD_SHAPE='Users can mark announcements read|PERMISSIVE|{public}|INSERT||(user_id = auth.uid()) / Users can read own announcement_reads|PERMISSIVE|{public}|SELECT|(user_id = auth.uid())| / mfa_required_when_enrolled|RESTRICTIVE|{authenticated}|ALL|( SELECT mfa_satisfied() AS mfa_satisfied)|( SELECT mfa_satisfied() AS mfa_satisfied) ## anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'
# 変わる物: announcement_reads の表の権限（rel の行）と、増えるポリシー1つ
CHANGED_RE='^pol announcement_reads |^rel announcement_reads '
WANT_ADDED=2
WANT_REMOVED=1
# ロールバック節の数と、; で終わる行の数（節 1〜2）
WANT_RB_BLOCKS=2
WANT_RB_STMTS=3
# 本 migration の最初の文（コメントと空行を除いた先頭の5行）
WANT_FIRST="$(cat <<'EOF'
do $$
begin
  set local lock_timeout = '3s';
  lock table public.announcement_reads in access exclusive mode;
end $$;
EOF
)"

shopt -s nullglob
targets=("$MIG"/*_announcement_reads_privs.sql)
shopt -u nullglob
if [ "${#targets[@]}" -ne 1 ]; then
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi
# REAL_TARGET: supabase/migrations の中の本 migration（ここまでの migrations を流す区切り）
# TARGET: 実際に流す版（TARGET_FILE で差し替えられる）
REAL_TARGET="${targets[0]}"
TARGET="${TARGET_FILE:-$REAL_TARGET}"
[ -f "$TARGET" ] || { echo "TARGET_FILE not found: $TARGET"; exit 1; }

WORK="$(mktemp -d /tmp/arp.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT="${PORT:-54471}"
mkdir -p "$SOCK"
BG_PID=""
cleanup(){
  if [ -n "$BG_PID" ]; then kill "$BG_PID" >/dev/null 2>&1 || true; fi
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
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

# スキーマの指紋（public の表・列・列ごとの権限・ポリシー・関数・トリガー・制約・表の権限・索引）。データは含まない。
#   1つの物は1行（ポリシーの条件の中の改行と空白はつめる）。
fingerprint(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select regexp_replace(x, '\s+', ' ', 'g') from (
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
) s order by 1;
SQL
}

# announcement_reads のポリシー（名前|種類|役割|操作|using|with check）と表の権限
policies_and_acl(){
  psql "$(conn "$1")" -qtA -v ON_ERROR_STOP=1 <<'SQL'
select (select string_agg(format('%s|%s|%s|%s|%s|%s', p.policyname, p.permissive, p.roles::text, p.cmd,
                                 regexp_replace(replace(coalesce(p.qual, ''), 'public.', ''), '\s+', ' ', 'g'),
                                 regexp_replace(replace(coalesce(p.with_check, ''), 'public.', ''), '\s+', ' ', 'g')),
                          ' / ' order by p.policyname collate "C")
          from pg_policies p where p.schemaname = 'public' and p.tablename = 'announcement_reads')
       || ' ## '
       || (select string_agg(ai::text, ',' order by ai::text collate "C")
             from pg_class c, unnest(c.relacl) ai where c.oid = 'public.announcement_reads'::regclass);
SQL
}

run_assert(){
  set +e
  PGOPTIONS='--client-min-messages=notice' psql "$(conn "$1")" -v ON_ERROR_STOP=1 -f "$ASSERT" > "$2" 2>&1
  set -e
  if grep "ERROR" "$2" | grep -qv "ANNOUNCEMENT READS PRIVS CHECKS FAILED"; then
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

# assert の PASS / FAIL の label の一覧（並べ替え済み）
labels(){ { grep -oE '(PASS|FAIL)\[[a-z0-9_]+\]' "$1" || true; } | LC_ALL=C sort -u; }

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

GOT="$(policies_and_acl base)"
if [ "$GOT" = "$PROD_SHAPE" ]; then
  record "PASS[base_matches_production]: policies and table grants are the same as production"
else
  record "FAIL[base_matches_production]: got $GOT"
fi

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
  newdb -T base checks
  OUT="$WORK/checks.out"
  run_assert checks "$OUT"
  grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true
  sed 's/^/  /' "$RES"
  echo "PASS: $(grep -c '^PASS\[' "$RES" || true)  FAIL: $(grep -c '^FAIL\[' "$RES" || true)"
  S="$(shape "$OUT")"
  if grep -q '^PASS\[base_matches_production\]' "$RES"; then
    case "$S" in
      red:*) echo ""; echo "RED CONFIRMED: $S (without the migration)"; exit 0 ;;
    esac
  fi
  echo "RED MISMATCH: $S"; exit 1
fi

echo "== before the target: assert on a copy (must be red; kept for the rollback comparison) =="
newdb -T base base_pre
run_assert base_pre "$WORK/base_pre.out"
S="$(shape "$WORK/base_pre.out")"
case "$S" in
  red:*) record "PASS[red_before_the_migration]: $S" ;;
  *)     record "FAIL[red_before_the_migration]: $S" ;;
esac

fingerprint base > "$WORK/fp_before.txt"
echo "== target migration (verbatim, applied twice = idempotent; locks read at the end of each apply): $(basename "$TARGET") =="
for k in first second; do
  if ! apply_with_lock_probe base "$TARGET" "$WORK/locks_$k.txt"; then
    echo "target migration failed ($k apply)"; exit 1
  fi
done
fingerprint base > "$WORK/fp_after.txt"

newdb -T base checks

echo "== checks: announcement_reads_privs_assert.sql =="
OUT="$WORK/checks.out"
run_assert checks "$OUT"
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

echo "== scope: only the announcement_reads table grants change and one policy is added =="
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

echo "== locks =="
FIRST="$(grep -vE '^[[:space:]]*(--.*)?$' "$TARGET" | head -5 || true)"
if [ "$FIRST" = "$WANT_FIRST" ]; then
  record "PASS[lock_first_statement]: announcement_reads in access exclusive mode, lock_timeout 3s"
else
  record "FAIL[lock_first_statement]: $(printf '%s' "$FIRST" | tr '\n' ' ')"
fi
for k in first second; do
  F="$WORK/locks_$k.txt"
  L="$(tr '\n' ' ' < "$F" | sed 's/ *$//')"
  MAIN="$(grep -E '^announcement_reads=' "$F" || true)"
  OTHER="$(grep -v '^announcement_reads=' "$F" | grep -v '^$' | grep -vE '^[^=]+=AccessShareLock$' || true)"
  case "$MAIN" in
    *AccessExclusiveLock*)
      if [ -z "$OTHER" ]; then
        record "PASS[lock_${k}_apply_only_announcement_reads_strong]: $L"
      else
        record "FAIL[lock_${k}_apply_only_announcement_reads_strong]: other strong locks: $(printf '%s' "$OTHER" | tr '\n' ' ')"
      fi ;;
    *)
      record "FAIL[lock_${k}_apply_only_announcement_reads_strong]: no AccessExclusiveLock on announcement_reads: $L" ;;
  esac
done

echo "== lock timeout: while another session uses announcement_reads, the migration gives up in about 3 seconds and changes nothing =="
newdb -T base_pre lt
fingerprint lt > "$WORK/fp_lt_before.txt"
psql "$(conn lt)" -q -c "begin; lock table public.announcement_reads in row exclusive mode; select pg_sleep(60); commit;" >/dev/null 2>&1 &
BG_PID=$!
HELD="$(psql "$(conn lt)" -qtA -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  for i in 1..200 loop
    exit when exists (select 1 from pg_locks l
                       where l.relation = 'public.announcement_reads'::regclass and l.mode = 'RowExclusiveLock'
                         and l.granted and l.pid <> pg_backend_pid());
    perform pg_sleep(0.05);
  end loop;
end $$;
select count(*) from pg_locks l
 where l.relation = 'public.announcement_reads'::regclass and l.mode = 'RowExclusiveLock'
   and l.granted and l.pid <> pg_backend_pid();
SQL
)"
T0="$(date +%s)"
set +e
OUT_LT="$(PGOPTIONS='--client-min-messages=warning' psql "$(conn lt)" -q -v ON_ERROR_STOP=1 -1 -f "$TARGET" 2>&1)"
RC_LT=$?
set -e
T1="$(date +%s)"
psql "$(conn lt)" -qtA -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'lt' and pid <> pg_backend_pid()" >/dev/null
wait "$BG_PID" 2>/dev/null || true
BG_PID=""
fingerprint lt > "$WORK/fp_lt_after.txt"
ELAPSED=$((T1 - T0))
LT_MSG=0
case "$OUT_LT" in *"canceling statement due to lock timeout"*) LT_MSG=1 ;; esac
if [ "$HELD" = "1" ] && [ "$RC_LT" -ne 0 ] && [ "$LT_MSG" -eq 1 ] && [ "$ELAPSED" -le 8 ] \
   && diff -q "$WORK/fp_lt_before.txt" "$WORK/fp_lt_after.txt" >/dev/null; then
  record "PASS[lock_gives_up_after_timeout]: gave up after ${ELAPSED}s with 'canceling statement due to lock timeout', nothing changed"
else
  record "FAIL[lock_gives_up_after_timeout]: held=$HELD rc=$RC_LT elapsed=${ELAPSED}s out=$(printf '%s' "$OUT_LT" | head -3 | tr '\n' ';')"
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

# (2) 挙動も戻る: 戻した複製で assert を流すと、適用前と同じ PASS / FAIL → 再適用した複製では全 PASS
newdb -T base rb
if PGOPTIONS='--client-min-messages=warning' psql "$(conn rb)" -q -v ON_ERROR_STOP=1 -1 -f "$RB" > "$WORK/rollback_rb.out" 2>&1; then
  newdb -T rb rb_checks
  run_assert rb_checks "$WORK/rb_checks.out"
  if diff <(labels "$WORK/base_pre.out") <(labels "$WORK/rb_checks.out") > "$WORK/labels.diff"; then
    record "PASS[rollback_restores_behaviour]: same PASS/FAIL as before the migration ($(shape "$WORK/rb_checks.out"))"
  else
    record "FAIL[rollback_restores_behaviour]: $(tr '\n' ' ' < "$WORK/labels.diff" | head -c 300)"
  fi
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

if [ "$NFAIL" -ne 0 ] || ! grep -q "ANNOUNCEMENT READS PRIVS CHECKS PASSED" "$OUT"; then
  echo "NOT PASSED"; tail -30 "$OUT"; exit 1
fi
echo ""
echo "ALL ANNOUNCEMENT READS PRIVS CHECKS PASSED (on real migrations)"
