#!/usr/bin/env bash
# =============================================================================
# 共通LINE org別クォータ 定期フル再同期 検証ハーネス
#
# overview harness と同じ全chain（platform_channel_budget/overview まで）を verbatim 適用し、
# さらに org_billing スタブ → 201858(trigger+backfill) → resync_setup(billing無しorg・stale値) →
# 205553_org_push_quota_resync.sql を適用して、資本時 resync の是正と service_role grant を検証する。
# grant が app_platform_budget_overview に効くため overview 系の依存もこの chain に含める。
# 使い捨てクラスタを起動し終了時に破棄する。本番DBには一切触れない。
#
# 使い方: bash supabase/tests/run_org_push_quota_resync.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH にあること（PG14+ 想定）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/opqr.XXXXXX)"
PGDATA="$WORK/data"; SOCK="$WORK/s"; PORT=54425
mkdir -p "$SOCK"
cleanup(){ pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

apply(){ echo "-- apply $(basename "$1")"; psql "$CONN" -q -v ON_ERROR_STOP=1 -1 -f "$1" >/dev/null; }

echo "== baseline + prerequisite migrations (verbatim) =="
apply "$TST/harness/baseline_stubs.sql"
apply "$MIG/20260703_001_rls_helpers.sql"
apply "$MIG/20260710204722_channel_plumbing.sql"
apply "$MIG/20260711073329_channel_groups_digest.sql"
apply "$MIG/20260713123924_group_pickup_mode.sql"
apply "$MIG/20260714153028_digest_due_assignee.sql"
apply "$MIG/20260715092422_shared_bot_accounts_owner_type.sql"
apply "$MIG/20260715092423_shared_bot_groups_tenant_source.sql"
apply "$MIG/20260715092424_shared_bot_link_codes_binding.sql"
apply "$MIG/20260715092425_shared_bot_group_claims_rpc.sql"
apply "$MIG/20260715092426_shared_bot_org_channel_policy.sql"
apply "$MIG/20260716175640_shared_bot_metering_billable_push.sql"
apply "$MIG/20260716175641_shared_bot_metering_state_cron.sql"
apply "$MIG/20260716183019_shared_bot_metering_sent_only.sql"
apply "$MIG/20260719100549_platform_channel_budget.sql"
apply "$MIG/20260719100634_platform_budget_state_cron.sql"
apply "$MIG/20260720201116_platform_budget_overview.sql"

echo "== org_billing stub + quota trigger migration =="
apply "$TST/harness/org_billing_stub.sql"
apply "$MIG/20260720201858_org_push_quota_from_plan.sql"

echo "== resync setup (billing-less org + stale value) =="
apply "$TST/harness/org_push_quota_resync_setup.sql"

echo "== target migration (verbatim, unmodified) =="
apply "$MIG/20260720205553_org_push_quota_resync.sql"

echo "== resync checks =="
OUT="$WORK/o.out"
PGOPTIONS='--client-min-messages=notice' psql "$CONN" -v ON_ERROR_STOP=1 -f "$TST/org_push_quota_resync_data.sql" > "$OUT" 2>&1 \
  || { echo "STEP FAILED"; grep -E "FAIL\[|ERROR" "$OUT" | head; exit 1; }
grep -oE "(PASS|FAIL)\[[a-z0-9_]+\]" "$OUT" || true
echo "PASS: $(grep -c 'PASS\[' "$OUT")  FAIL: $(grep -c 'FAIL\[' "$OUT")"
grep -q "ORG PUSH QUOTA RESYNC CHECKS PASSED" "$OUT" || { echo "NOT PASSED"; tail -30 "$OUT"; exit 1; }
echo ""
echo "ALL ORG PUSH QUOTA RESYNC CHECKS PASSED (on real migration)"
