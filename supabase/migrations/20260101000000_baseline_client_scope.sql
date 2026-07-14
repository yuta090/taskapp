-- =============================================================================
-- ベースライン取り込み: tasks.client_scope
--
-- 背景:
--   client_scope は docs/db/DDL_v0.5_client_scope.sql として本番へ手動適用されており、
--   supabase/migrations には存在しなかった。そのため migrations 上では
--     - 20260703_010_rls_vendor_task_scope.sql（RLSポリシー）
--     - 20260706003903_ball_client_scope_invariant.sql（RPC/トリガー）
--   が「定義されていない列」を参照する状態になっていた。
--
-- ファイル名の日時が過去なのは意図的:
--   上記2つより前にソートされる必要があるため（現在時刻にすると、列を追加する前に
--   参照する migration が走る）。命名規約 YYYYMMDDHHMMSS には従いつつ、順序制約を優先する。
--
-- 本番への適用手順（共有本番DB・CLI管理外のため手動）:
--   1. psql で本ファイルを実行する（既存列があれば下の検証ブロックが差異を検出して落ちる）
--   2. 成功したら applied_migrations へ INSERT して記録する
--   ※ 既に列がある本番では ALTER/CREATE INDEX は no-op。実質的な変更はカラムコメントのみ。
--
-- 注意（重要）:
--   DB の既定値は 'deliverable'（＝クライアントポータルに表示される）。
--   'internal' 既定はアプリ層（src/lib/hooks/useTasks.ts）でのみ適用されている。
--   したがって useTasks を経由しない INSERT（RPC 等）は client_scope を明示しなければ
--   クライアントに見えるタスクを作る。RPC 実装時は必ず明示すること。
--   （DB既定を 'internal' に変えるのは別issue: 20240206_000_minutes_parser.sql が
--     client_scope 省略かつ ball='client' で INSERT しており、既定を変えると
--     enforce_ball_client_scope トリガーに弾かれる。全INSERT経路の監査が要る）
-- =============================================================================

alter table public.tasks add column if not exists client_scope text
  not null default 'deliverable'
  check (client_scope in ('deliverable', 'internal'));

create index if not exists tasks_client_scope_idx on public.tasks(client_scope);

create index if not exists tasks_portal_query_idx
  on public.tasks(space_id, ball, client_scope, status);

comment on column public.tasks.client_scope is
  'クライアントポータルでの可視性。deliverable=表示（納品物関連）, internal=非表示（内部作業）。DB既定は deliverable のため、RPC 等から INSERT する場合は必ず明示すること';

-- -----------------------------------------------------------------------------
-- 実スキーマとの乖離検出（fail-fast）
--
-- `IF NOT EXISTS` は「列が既にある」場合、その型・NOT NULL・DEFAULT・CHECK が
-- 本 migration の意図と一致するかを一切検証しない。本番が既に別定義（nullable、
-- DEFAULT なし、CHECK の許可値違い 等）になっていても "適用済み" と記録されてしまい、
-- 履歴と実スキーマの不整合が固定化する。client_scope は顧客可視性を左右する列なので、
-- 黙って通すのではなく、差異があればここで落とす。
-- -----------------------------------------------------------------------------
do $$
declare
  v_is_nullable text;
  v_default text;
  v_type text;
  v_check_ok boolean;
begin
  select c.is_nullable, c.column_default, c.data_type
    into v_is_nullable, v_default, v_type
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'tasks' and c.column_name = 'client_scope';

  if v_is_nullable is null then
    raise exception 'baseline_client_scope: tasks.client_scope が作成されていない';
  end if;

  if v_type <> 'text' then
    raise exception 'baseline_client_scope: tasks.client_scope の型が text でない (実際: %)', v_type;
  end if;

  if v_is_nullable <> 'NO' then
    raise exception 'baseline_client_scope: tasks.client_scope が NOT NULL でない（本番がnullable。要調査）';
  end if;

  if v_default is null or v_default not like '%deliverable%' then
    raise exception 'baseline_client_scope: tasks.client_scope の DEFAULT が deliverable でない (実際: %)', coalesce(v_default, 'NULL');
  end if;

  -- CHECK が deliverable/internal の2値に閉じていること
  select exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'tasks' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%client_scope%'
      and pg_get_constraintdef(con.oid) like '%deliverable%'
      and pg_get_constraintdef(con.oid) like '%internal%'
  ) into v_check_ok;

  if not v_check_ok then
    raise exception 'baseline_client_scope: tasks.client_scope の CHECK 制約が見つからない（deliverable/internal に閉じていない）';
  end if;
end $$;
