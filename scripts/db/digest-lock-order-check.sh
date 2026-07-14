#!/bin/bash
# 2セッションを交差させ、リンクRPCと一括投入RPCがデッドロックしないことを検証する。
# 各セッションは最後に ROLLBACK するため、本番DBには何も残らない。
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
DB_URL=$(grep -m1 '^[[:space:]]*SUPABASE_DB_URL=' .env.local | cut -d= -f2- | tr -d '"')

# 検証に使う既存グループ（space確定済み）と、そのメッセージ
read -r GROUP_ID MSG_ID <<<"$(psql "$DB_URL" -t -A -F' ' -c "
  select g.id, m.id from channel_groups g
  join channel_messages m on m.group_id = g.id
  where g.space_id is not null limit 1;")"
echo "target group=$GROUP_ID msg=$MSG_ID"

# migration をこのセッションだけに効かせることはできないため、
# 事前に「トリガー＋RPC が適用済みの状態」を作る必要がある。
# → 一時的に別トランザクションで適用し、テスト後に元へ戻すのは危険なので、
#    ここでは *適用後の本番* を前提に走らせる（本テストは適用直後に実行する）。

run_case () {
  local name="$1" first="$2" second="$3"
  echo "--- $name ---"
  # セッションA: ロックを掴んで3秒保持してから ROLLBACK
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "begin;" -c "$first" -c "select pg_sleep(3);" -c "rollback;" \
    > /tmp/sessA.log 2>&1 &
  local pid_a=$!
  sleep 1
  # セッションB: Aがロックを持っている間に実行 → 待つはず。デッドロックなら即座にエラー
  local start=$(date +%s)
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "begin;" -c "$second" -c "rollback;" \
    > /tmp/sessB.log 2>&1
  local rc=$?
  local elapsed=$(( $(date +%s) - start ))
  wait $pid_a
  local rc_a=$?

  if grep -qi "deadlock" /tmp/sessA.log /tmp/sessB.log; then
    echo "  ❌ DEADLOCK detected"
    cat /tmp/sessA.log /tmp/sessB.log
    return 1
  fi
  if [ $rc -ne 0 ] || [ $rc_a -ne 0 ]; then
    echo "  ❌ session failed (A=$rc_a B=$rc)"
    cat /tmp/sessA.log /tmp/sessB.log
    return 1
  fi
  echo "  ✅ 両セッション完了（Bは ${elapsed}s 待機＝直列化されている）"
}

INGEST="select rpc_ingest_digest_tasks('$GROUP_ID'::uuid, now(), jsonb_build_array(jsonb_build_object('source_message_id','$MSG_ID','title','【CONC】テスト','assignee_hint',null,'assignee_external_user_id','U-conc','assignee_identity_id',null,'due_date',null,'due_time',null)));"
LINKUPD="update channel_groups set display_name = display_name where id = '$GROUP_ID'::uuid;"
INSERT_TASK="insert into channel_digest_tasks (org_id, group_id, space_id, source_message_id, title, assignee_external_user_id, extracted_date) select org_id, id, space_id, '$MSG_ID'::uuid, '【CONC】直INSERT', 'U-conc2', current_date from channel_groups where id = '$GROUP_ID'::uuid;"

fail=0
# ケース1: ingest（group をFOR UPDATE→子行INSERT→水位UPDATE）が先、group UPDATE（リンク相当）が後
run_case "ingest → link" "$INGEST" "$LINKUPD" || fail=1
# ケース2: group UPDATE（リンク相当）が先、ingest が後
run_case "link → ingest" "$LINKUPD" "$INGEST" || fail=1
# ケース3: group UPDATE が先、子行の直INSERT（トリガーのFOR SHARE）が後
run_case "link → direct insert" "$LINKUPD" "$INSERT_TASK" || fail=1
# ケース4: 直INSERT が先、group UPDATE が後
run_case "direct insert → link" "$INSERT_TASK" "$LINKUPD" || fail=1

echo
if [ $fail -eq 0 ]; then echo "RESULT: デッドロックなし（全4ケース）"; else echo "RESULT: 失敗あり"; fi
exit $fail
