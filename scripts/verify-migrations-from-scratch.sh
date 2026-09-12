#!/usr/bin/env bash
# supabase/migrations を「空DBに先頭から順に適用」して再構築できるかを検証する。
#
# 目的: migration の順序崩れ（列を参照する migration が、列を追加する migration より先に走る）を検出する。
#   実例: tasks.client_scope は docs/db/DDL_v0.5_client_scope.sql で本番に手動適用されており、
#   supabase/migrations には存在しなかった。そのため 20260703_010 / 20260706003903 が
#   存在しない列を参照し、空DBからの再構築が不可能だった。
#
# あわせて、全 migration を流したあとの状態を検査する:
#   - 二要素認証の RESTRICTIVE ポリシーが全 RLS テーブルにある・authenticator の pre-request
#   - 関数の実行権（public に作る関数は既定で誰にも付かない。*_function_default_privileges.sql）:
#       1) RLS のポリシーが直接呼ぶ public の関数を authenticated が実行できる
#       2) 実行権（proacl）が null の public の関数が無い（トリガー関数・拡張の関数は除く）
#       3) anon が実行できる SECURITY DEFINER の関数が、許容リスト（supabase/tests/allowlist/anon_definer_functions.txt）の中だけ
#     関数の実行権は本番の Supabase と同じ既定（supabase/tests/harness/supabase_function_default_acl.sql）の上で見る。
#   - 表・ビュー・シーケンスの権限（*_table_privileges.sql）:
#       4) security_invoker でない public のビュー（実体化ビューを含む）に、anon / authenticated / PUBLIC の権限が無い
#       5) RLS が無効な public の表に、anon / authenticated / PUBLIC の書き込みの権限（insert / update / delete / truncate）が無い
#       6) anon と PUBLIC は、public の表・ビュー・シーケンスの権限（列ごとの付与も）を持たない
#       7) authenticated は、public の表・ビューで truncate / references / trigger / maintain を持たない
#     表の権限は本番の Supabase と同じ既定の付与（supabase/tests/harness/supabase_table_default_acl.sql）の上で見る
#     （_local_bootstrap.sql には入れない。代役を自分で選ぶハーネスの前提を変えないため）。
#
# 前提: PostgreSQL 17 が入っていること（本番と同じメジャーバージョン）
#   brew install postgresql@17
#
# 使い方: ./scripts/verify-migrations-from-scratch.sh
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PATH="$PGBIN:$PATH"

PORT="${PGPORT:-55432}"
HOST="127.0.0.1"
DB="mig_verify_$$"

command -v psql >/dev/null || { echo "psql が見つかりません（PGBIN を設定してください）"; exit 1; }
pg_isready -h "$HOST" -p "$PORT" -q || {
  echo "スクラッチ用 Postgres が $HOST:$PORT で起動していません。"
  echo "例: initdb -D /tmp/ccpgdata -U postgres && pg_ctl -D /tmp/ccpgdata -o \"-p $PORT -h $HOST\" start"
  exit 1
}

# 後片付け。最後の確認まで来なかったときは、0 で終わらせない
#   （bash は未定義の変数などで途中で落ちると、ここで $? が 0 になることがある）
finished=0
cleanup() {
  local rc=$?
  psql -h "$HOST" -p "$PORT" -U postgres -q -c "drop database if exists \"$DB\";" >/dev/null 2>&1 || true
  if [ "$rc" -eq 0 ] && [ "$finished" -ne 1 ]; then
    echo "❌ 検証が途中で止まりました（上のメッセージを確認してください）"
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT

psql -h "$HOST" -p "$PORT" -U postgres -q -c "create database \"$DB\";"
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/_local_bootstrap.sql
# 本番の Supabase と同じ「関数の既定の実行権」（無いと下の関数の実行権の検査が確かめにならない）
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/harness/supabase_function_default_acl.sql
# 本番の Supabase と同じ「表・ビュー・シーケンスの既定の付与」（無いと下の表の権限の検査が確かめにならない）
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/harness/supabase_table_default_acl.sql

applied=0
for f in $(ls supabase/migrations/*.sql | sort); do
  if ! psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>/tmp/mig_err.txt; then
    echo "❌ 適用失敗: $(basename "$f")"
    grep -m3 "ERROR" /tmp/mig_err.txt || cat /tmp/mig_err.txt
    echo
    echo "適用済み: ${applied} 件"
    exit 1
  fi
  applied=$((applied + 1))
done

# 二要素認証の RESTRICTIVE ポリシー（mfa_required_when_enrolled）が全 RLS テーブルに付いているか（新規テーブルの取りこぼし検出）
missing=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select tablename from pg_tables t where schemaname='public' and rowsecurity and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename and p.policyname='mfa_required_when_enrolled')")
if [ -n "$missing" ]; then
  echo "❌ 二要素認証ポリシー(mfa_required_when_enrolled)が無い RLS テーブル: $missing"
  echo "   → supabase/migrations/*_mfa_rls_enforcement.sql の DO ブロックを新しい migration で再実行してください"
  exit 1
fi

prereq=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select count(*) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname='authenticator' and exists (select 1 from unnest(s.setconfig) c where c='pgrst.db_pre_request=public.mfa_pre_request')")
if [ "$prereq" != "1" ]; then
  echo "❌ authenticator の pgrst.db_pre_request が public.mfa_pre_request になっていません（後続の migration が reset していないか確認）"
  exit 1
fi

# 関数の実行権（public に作る関数は既定で誰にも付かない）。3つとも見てから落とす
fn_failed=0

# 1) RLS のポリシー（authenticated か PUBLIC に効くもの）が直接呼ぶ public の関数は、authenticated が実行できる
#    （実行できないと、そのポリシーのある表を読む・書くたびに権限エラーになる）
no_exec=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(distinct p.oid::regprocedure::text, ', ') from pg_policy pol join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid and d.refclassid = 'pg_proc'::regclass join pg_proc p on p.oid = d.refobjid where p.pronamespace = 'public'::regnamespace and pol.polroles && array[0::oid, 'authenticated'::regrole::oid] and not has_function_privilege('authenticated', p.oid, 'execute')")
if [ -n "$no_exec" ]; then
  echo "❌ RLS のポリシーが呼ぶ関数を authenticated が実行できません: ${no_exec}"
  echo "   → その関数を作った migration に grant execute on function … to authenticated を足してください"
  fn_failed=1
fi

# 2) 実行権（proacl）が null の public の関数は無い（null = 組み込みの既定で PUBLIC が実行できる。トリガー関数・拡張の関数は除く）
null_acl=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proacl is null and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')")
if [ -n "$null_acl" ]; then
  echo "❌ 実行権が決まっていない（proacl が null の）関数: ${null_acl}"
  echo "   → 作った migration で revoke … from public, anon, authenticated → 呼ぶ役割にだけ grant してください"
  fn_failed=1
fi

# 3) anon（未ログイン）が実行できる SECURITY DEFINER の関数は、許容リストの中だけ（名前は public.関数名(引数の型)）
#    トリガー関数は直接呼べない（トリガーとしてしか動かない）ので除く
allow=supabase/tests/allowlist/anon_definer_functions.txt
anon_now=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -t -A -c "set search_path = ''" -c "select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and has_function_privilege('anon', p.oid, 'execute')" | LC_ALL=C sort)
if [ ! -f "$allow" ]; then
  echo "❌ 許容リストがありません: ${allow}"
  fn_failed=1
else
  allowed=$({ grep -vE '^[[:space:]]*(#|$)' "$allow" || true; } | LC_ALL=C sort)
  extra=$(LC_ALL=C comm -23 <(printf '%s\n' "$anon_now") <(printf '%s\n' "$allowed") | grep -v '^$' || true)
  stale=$(LC_ALL=C comm -13 <(printf '%s\n' "$anon_now") <(printf '%s\n' "$allowed") | grep -v '^$' || true)
  if [ -n "$extra" ]; then
    echo "❌ anon（未ログイン）が実行できる SECURITY DEFINER の関数が、許容リスト（${allow}）の外にあります:"
    printf '%s\n' "$extra" | sed 's/^/   /'
    echo "   → anon から呼ぶ必要が無ければ revoke execute … from anon。必要なら許容リストに足す"
    fn_failed=1
  fi
  if [ -n "$stale" ]; then
    echo "ℹ️  許容リストにあるが、もう anon が実行できない関数（リストから消してよい）:"
    printf '%s\n' "$stale" | sed 's/^/   /'
  fi
fi

if [ "$fn_failed" -ne 0 ]; then
  exit 1
fi

# 表・ビュー・シーケンスの権限（*_table_privileges.sql）。4つとも見てから落とす
#   本番と同じ既定の付与（supabase_table_default_acl.sql）の上で見るので、本番で付いてしまう物がここでも付く
grant_failed=0

# 4) security_invoker でないビュー（実体化ビューを含む）は、作った役割の権限で元の表を読む（RLS を通らない）。
#    anon / authenticated / PUBLIC の権限を持たせない
bad_views=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(c.relname, ', ' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and not coalesce(c.reloptions @> array['security_invoker=true'], false) and exists (select 1 from aclexplode(c.relacl) a where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))")
if [ -n "$bad_views" ]; then
  echo "❌ security_invoker でないビューに anon / authenticated / PUBLIC の権限があります: ${bad_views}"
  echo "   → ビューは with (security_invoker = true) で作り、作った migration で anon / authenticated の権限を明示で決めてください"
  grant_failed=1
fi

# 5) RLS が無効な表は、行を絞れない。anon / authenticated / PUBLIC に書き込みの権限（insert / update / delete / truncate・列ごとも）を持たせない
rls_off_writes=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(distinct g.relname, ', ' order by g.relname) from (select c.relname, a.grantee, a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity union all select c.relname, x.grantee, x.privilege_type from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity and at.attnum > 0 and not at.attisdropped) g where g.grantee in (0, 'anon'::regrole, 'authenticated'::regrole) and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')")
if [ -n "$rls_off_writes" ]; then
  echo "❌ RLS が無効な表に、anon / authenticated / PUBLIC の書き込みの権限があります: ${rls_off_writes}"
  echo "   → RLS を有効にしてポリシーを書くか、書き込みの権限を revoke してください"
  grant_failed=1
fi

# 6) anon（未ログイン）と PUBLIC は、public の表・ビュー・シーケンスの権限を持たない（列ごとの付与も）
anon_rels=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(distinct g.relname, ', ' order by g.relname) from (select c.relname, a.grantee from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') union all select c.relname, x.grantee from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x where c.relnamespace = 'public'::regnamespace and at.attnum > 0 and not at.attisdropped) g where g.grantee in (0, 'anon'::regrole)")
if [ -n "$anon_rels" ]; then
  echo "❌ anon（未ログイン）か PUBLIC が権限を持つ表・ビュー・シーケンスがあります: ${anon_rels}"
  echo "   → 作った migration で revoke all … from public, anon を足してください（未ログインで読む物はサーバーの鍵か SECURITY DEFINER の関数で）"
  grant_failed=1
fi

# 7) authenticated は、public の表・ビューで truncate / references / trigger / maintain を持たない（列ごとの references も）
auth_extra=$(psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -t -A -c "select string_agg(distinct g.relname, ', ' order by g.relname) from (select c.relname, a.grantee, a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') union all select c.relname, x.grantee, x.privilege_type from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) x where c.relnamespace = 'public'::regnamespace and at.attnum > 0 and not at.attisdropped) g where g.grantee = 'authenticated'::regrole and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')")
if [ -n "$auth_extra" ]; then
  echo "❌ authenticated が truncate / references / trigger / maintain を持つ表・ビューがあります: ${auth_extra}"
  echo "   → authenticated には select / insert / update / delete のうち要る物だけを付けてください"
  grant_failed=1
fi

if [ "$grant_failed" -ne 0 ]; then
  exit 1
fi

finished=1
echo "✅ 空DBから ${applied} 件の migration を適用できました（二要素認証ポリシーの漏れなし・pre-request 設定あり・関数の実行権と表の権限の検査を通過）"
