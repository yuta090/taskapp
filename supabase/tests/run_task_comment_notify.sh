#!/usr/bin/env bash
# =============================================================================
# タスクのコメントのお知らせ（*_task_comment_notify.sql）の検証ハーネス
#
# 使い捨てクラスタで、scripts/verify-migrations-from-scratch.sh と同じく _local_bootstrap.sql の上に
# supabase/migrations を先頭から順に verbatim で流し（本 migration の手前まで）、検証に使うデータベースを作る。
# migrations の前に harness/space_role_boundary_setup.sql（Supabase が本番で持っている権限の代役）を足す。
# migration は1行も変えない。
# 本 migration の前に task_comment_notify_seed.sql で人物・タスク・依頼・コメントを作り、
# 本 migration を2回適用して（冪等）、task_comment_notify_assert.sql で確かめる:
#   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
#   same_*  変えないもの（両方で PASS）
# assert の出力から、お知らせづくり・お知らせを消すのが失敗したときの警告が出たかも見る
# （chg_notice_failure_warns / chg_retract_failure_warns）。
# 続けて GREEN のときだけ:
#   scope_*     本 migration で増えるのは、関数3つ・トリガー2つ・列1つ・制約1つ・索引1つだけ。ほかの関数・トリガー・
#               ポリシー・列・表の権限・制約は変わらない。2回適用してもトリガーはそれぞれ1つ
#   reapply_*   データが入った状態で再適用できる（お知らせが増えない・そのあとのコメントのお知らせも1人1行）
#   rollback_*  先頭のコメントの「ロールバック（手で流す」の手順を流すと、適用前のスキーマに戻り、コメントを書いても
#               お知らせが作られず、コメントを消してもお知らせが消えない → 戻したあと再適用できる
#   guard_*     同じ名前の別のトリガーが task_comments にあれば（task_comments_notify / task_comments_retract_notice）、
#               末尾の確認で適用が止まり、何も変わらない
#
# 使い方:
#   bash supabase/tests/run_task_comment_notify.sh          # 全 PASS を期待
#   RED=1 bash supabase/tests/run_task_comment_notify.sh    # 本 migration を適用せずに流し、
#       chg_* が全て FAIL・same_* が全て PASS する（= テストが変化を検出でき、変えない所は従来どおり）ことを確認する
#       （本 migration のファイルがまだ無いときは、今ある migrations を全部流す）
# 一時データの置き場所は WORK_BASE で変えられる（既定 /tmp）。ソケットはパスの長さの上限があるので /tmp に置く。
# ポートは TCN_PORT で変えられる（既定 54473。ソケットは毎回別のフォルダなので、同じポートでも並べて流せる）。
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
targets=("$MIG"/*_task_comment_notify.sql)
shopt -u nullglob
if [ "${#targets[@]}" -eq 1 ]; then
  TARGET="${targets[0]}"
elif [ "${#targets[@]}" -eq 0 ] && [ "$RED" = "1" ]; then
  TARGET=""
else
  echo "target migration not found or ambiguous: ${targets[*]:-none}"; exit 1
fi

WORK="$(mktemp -d "${WORK_BASE:-/tmp}/tcn.XXXXXX")"
SOCK="$(mktemp -d /tmp/tcn_s.XXXXXX)"
PGDATA="$WORK/data"; PORT="${TCN_PORT:-54473}"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK" "$SOCK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
conn(){ echo "host=$SOCK port=$PORT user=postgres dbname=$1"; }
newdb(){ createdb -h "$SOCK" -p "$PORT" -U postgres "$@"; }

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
NEW_RE='app_task_comment_notify|app_task_comment_visible_to_user|app_task_comment_retract_notice|task_comments\.mention_user_ids|task_comments_mention_user_ids_check|notifications_task_comment_dedupe_idx'

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

echo "== seed: 人物・タスク・依頼・コメント（本 migration の前からあるデータ） =="
apply base "$TST/task_comment_notify_seed.sql"

if [ "$RED" = "1" ]; then
  echo "== RED mode: target migration is NOT applied =="
else
  # 本 migration の前の状態を残しておく（scope_* / rollback_* / guard_* 用）
  newdb -T base pre
  fingerprint base > "$WORK/fp_before.txt"
  echo "== target migration (verbatim, applied twice = idempotent): $(basename "$TARGET") =="
  apply base "$TARGET"
  apply base "$TARGET"
fi

newdb -T base checks

echo "== checks: task_comment_notify_assert.sql =="
OUT="$WORK/checks.out"
set +e
PGOPTIONS='--client-min-messages=notice' psql "$(conn checks)" -v ON_ERROR_STOP=1 \
  -f "$TST/task_comment_notify_assert.sql" > "$OUT" 2>&1
set -e
# grep は一致が無いと 1 を返す（pipefail で止まらないよう || true）
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\].*" "$OUT" >> "$RES" || true

# assert の中のエラーは test.run / test.val が文字列にして返すので、ここに出る ERROR はハーネスかテストデータの不備
if grep -q "ERROR" "$OUT"; then
  echo "HARNESS ERROR:"; grep -B2 -A3 "ERROR" "$OUT" | head -40; exit 1
fi

# お知らせづくりが失敗したとき、コメントの保存は止めずに警告を出す
if grep -q "WARNING:  task comment notify: " "$OUT"; then
  record "PASS[chg_notice_failure_warns]: $(grep -m1 -o 'task comment notify: .*' "$OUT")"
else
  record "FAIL[chg_notice_failure_warns]: no warning"
fi
# お知らせを消すのが失敗したとき、コメントの削除は止めずに警告を出す
if grep -q "WARNING:  task comment retract: " "$OUT"; then
  record "PASS[chg_retract_failure_warns]: $(grep -m1 -o 'task comment retract: .*' "$OUT")"
else
  record "FAIL[chg_retract_failure_warns]: no warning"
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

echo "== scope: 増えるのは関数3つ・トリガー2つ・列1つ・制約1つ・索引1つだけ =="
fingerprint base > "$WORK/fp_after_full.txt"
N_BEFORE_NEW="$(grep -cE "$NEW_RE" "$WORK/fp_before.txt" || true)"
grep -vE "$NEW_RE" "$WORK/fp_after_full.txt" > "$WORK/fp_after.txt" || true
if [ "$N_BEFORE_NEW" = "0" ] && diff -q "$WORK/fp_before.txt" "$WORK/fp_after.txt" >/dev/null; then
  record "PASS[scope_only_intended_objects_changed]: same"
else
  record "FAIL[scope_only_intended_objects_changed]: before_new=$N_BEFORE_NEW $(diff "$WORK/fp_before.txt" "$WORK/fp_after.txt" | head -5 | tr '\n' ' ')"
fi
N_ADDED="$(grep -cE "$NEW_RE" "$WORK/fp_after_full.txt" || true)"
if [ "$N_ADDED" = "8" ]; then
  record "PASS[scope_added_objects]: $N_ADDED"
else
  record "FAIL[scope_added_objects]: $N_ADDED (want 8) $(grep -E "$NEW_RE" "$WORK/fp_after_full.txt" | tr '\n' ' ')"
fi
N_TRG="$(q base "select format('%s|%s',
  (select count(*) from pg_trigger where tgrelid = 'public.task_comments'::regclass and tgfoid = to_regprocedure('public.app_task_comment_notify()')),
  (select count(*) from pg_trigger where tgrelid = 'public.task_comments'::regclass and tgfoid = to_regprocedure('public.app_task_comment_retract_notice()')))")"
if [ "$N_TRG" = "1|1" ]; then record "PASS[scope_single_trigger_after_twice]: $N_TRG"; else record "FAIL[scope_single_trigger_after_twice]: $N_TRG (want 1|1)"; fi

echo "== re-apply with data present =="
N_BEFORE="$(q checks "select count(*) from public.notifications")"
if apply checks "$TARGET"; then record "PASS[reapply_with_data]: ok"; else record "FAIL[reapply_with_data]: apply failed"; fi
N_AFTER="$(q checks "select count(*) from public.notifications")"
if [ "$N_BEFORE" = "$N_AFTER" ]; then
  record "PASS[reapply_no_new_notice]: $N_AFTER"
else
  record "FAIL[reapply_no_new_notice]: $N_BEFORE -> $N_AFTER"
fi
# 再適用のあとに書いたコメントも、お知らせは1人1行（T1 に au が書く → as / rv / ap / pc の4人）
q checks "insert into public.task_comments (id, org_id, space_id, task_id, actor_id, body, visibility)
          values ('f1000000-0000-0000-0000-000000000099', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
                  'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '再適用のあと', 'internal')" >/dev/null
N_REAPPLY="$(q checks "select format('%s/%s', count(*), count(distinct to_user_id)) from public.notifications where dedupe_key = 'task_comment:f1000000-0000-0000-0000-000000000099'")"
if [ "$N_REAPPLY" = "4/4" ]; then
  record "PASS[reapply_notices_once_per_person]: $N_REAPPLY"
else
  record "FAIL[reapply_notices_once_per_person]: $N_REAPPLY (want 4/4)"
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
if [ "$NSTMT" -eq 7 ]; then
  record "PASS[rollback_steps_found]: $NSTMT statements"
else
  record "FAIL[rollback_steps_found]: $NSTMT statements (want 7)"
fi
newdb -T checks rb
if apply rb "$RB" 2>"$WORK/rollback_err.txt"; then
  record "PASS[rollback_applies]: ok"
  fingerprint rb > "$WORK/fp_rb.txt"
  if diff -q "$WORK/fp_before.txt" "$WORK/fp_rb.txt" >/dev/null; then
    record "PASS[rollback_restores_schema]: identical to pre-migration ($(wc -l < "$WORK/fp_before.txt" | tr -d ' ') objects)"
  else
    record "FAIL[rollback_restores_schema]: $(diff "$WORK/fp_before.txt" "$WORK/fp_rb.txt" | head -5 | tr '\n' ' ')"
  fi
  N_RB_BEFORE="$(q rb "select count(*) from public.notifications")"
  q rb "insert into public.task_comments (org_id, space_id, task_id, actor_id, body, visibility)
        values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
                'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '戻したあと', 'internal')" >/dev/null
  N_RB_AFTER="$(q rb "select count(*) from public.notifications")"
  if [ "$N_RB_BEFORE" = "$N_RB_AFTER" ]; then
    record "PASS[rollback_restores_behaviour]: no notice ($N_RB_AFTER)"
  else
    record "FAIL[rollback_restores_behaviour]: $N_RB_BEFORE -> $N_RB_AFTER"
  fi
  # 戻したあとは、コメントを消してもお知らせは消えない（再適用のあとに書いたコメントの4行が残る）
  N_RB_RET="$(q rb "select count(*) from public.notifications where dedupe_key = 'task_comment:f1000000-0000-0000-0000-000000000099'")"
  q rb "update public.task_comments set deleted_at = now() where id = 'f1000000-0000-0000-0000-000000000099'" >/dev/null
  N_RB_RET_AFTER="$(q rb "select count(*) from public.notifications where dedupe_key = 'task_comment:f1000000-0000-0000-0000-000000000099'")"
  if [ "$N_RB_RET" = "4" ] && [ "$N_RB_RET_AFTER" = "4" ]; then
    record "PASS[rollback_restores_behaviour_retract]: notices kept ($N_RB_RET_AFTER)"
  else
    record "FAIL[rollback_restores_behaviour_retract]: $N_RB_RET -> $N_RB_RET_AFTER (want 4 -> 4)"
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

echo "== guard: 同じ名前の別のトリガーがあれば止まる =="
newdb -T pre guard
q guard "create trigger task_comments_notify after insert on public.task_comments
         for each row execute function public.update_task_comments_updated_at()" >/dev/null
if apply guard "$TARGET" 2>"$WORK/guard_err.txt"; then
  record "FAIL[guard_stops_on_other_trigger]: applied"
elif grep -q "task comment notify" "$WORK/guard_err.txt"; then
  record "PASS[guard_stops_on_other_trigger]: stopped"
else
  record "FAIL[guard_stops_on_other_trigger]: $(head -1 "$WORK/guard_err.txt")"
fi
g_state(){
  q "$1" "select format('%s|%s|%s',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'task_comments' and column_name = 'mention_user_ids'),
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('app_task_comment_notify', 'app_task_comment_visible_to_user', 'app_task_comment_retract_notice')),
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'notifications_task_comment_dedupe_idx'))"
}
G_STATE="$(g_state guard)"
if [ "$G_STATE" = "0|0|0" ]; then
  record "PASS[guard_changes_nothing]: column|functions|index=$G_STATE"
else
  record "FAIL[guard_changes_nothing]: column|functions|index=$G_STATE"
fi

newdb -T pre guard2
q guard2 "create trigger task_comments_retract_notice after update on public.task_comments
          for each row execute function public.update_task_comments_updated_at()" >/dev/null
if apply guard2 "$TARGET" 2>"$WORK/guard2_err.txt"; then
  record "FAIL[guard_stops_on_other_retract_trigger]: applied"
elif grep -q "task comment notify" "$WORK/guard2_err.txt"; then
  record "PASS[guard_stops_on_other_retract_trigger]: stopped"
else
  record "FAIL[guard_stops_on_other_retract_trigger]: $(head -1 "$WORK/guard2_err.txt")"
fi
G2_STATE="$(g_state guard2)"
if [ "$G2_STATE" = "0|0|0" ]; then
  record "PASS[guard_retract_changes_nothing]: column|functions|index=$G2_STATE"
else
  record "FAIL[guard_retract_changes_nothing]: column|functions|index=$G2_STATE"
fi

echo ""
sed 's/^/  /' "$RES"
NPASS="$(grep -c '^PASS\[' "$RES" || true)"
NFAIL="$(grep -c '^FAIL\[' "$RES" || true)"
echo "PASS: $NPASS  FAIL: $NFAIL"
if [ "$NFAIL" -ne 0 ] || [ "$NPASS" -eq 0 ]; then
  echo "TASK COMMENT NOTIFY CHECKS FAILED"; exit 1
fi
echo "TASK COMMENT NOTIFY CHECKS PASSED"
