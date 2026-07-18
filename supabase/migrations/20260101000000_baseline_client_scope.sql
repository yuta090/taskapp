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

-- 複合インデックスは space_id / ball / status を参照する。これらは 20240101_000_schema.sql
-- で tasks 作成時に定義され、本 migration より前にソートされる前提。前提が崩れた場合
-- （tasks の骨格 migration が未適用のまま本ファイルが走った等）に `create index` が出す
-- cryptic な "column ... does not exist" ではなく、原因の分かる形で fail-fast する。
do $$
declare
  v_missing text;
begin
  select string_agg(col, ', ' order by col)
    into v_missing
  from unnest(array['space_id', 'ball', 'status']) as col
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'tasks' and c.column_name = col
  );

  if v_missing is not null then
    raise exception
      'baseline_client_scope: tasks に複合インデックスの参照列が無い: %（tasks の骨格 migration が先に適用されているか確認）',
      v_missing;
  end if;
end $$;

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

  -- column_default は Postgres が正規化した `'deliverable'::text` の形で入る。
  -- LIKE '%deliverable%' だと 'not_deliverable'::text や 'deliverable_v2'::text 等も
  -- 通してしまうため、正規化後の完全一致（先頭〜末尾アンカー）で検証する。
  if v_default is null or v_default !~ '^''deliverable''::text$' then
    raise exception 'baseline_client_scope: tasks.client_scope の DEFAULT が deliverable でない (実際: %)', coalesce(v_default, 'NULL');
  end if;

  -- CHECK が client_scope を deliverable/internal の「ちょうど2値」に閉じていること。
  -- pg_get_constraintdef は `col in (...)` を `col = ANY (ARRAY[...])` に正規化するため、
  -- IN を前提にした素朴なパターンは正しい制約でも誤って落ちる。正規化後の「制約式全体」に
  -- 先頭〜末尾アンカー(^...$)で一致させることで、下記の誤検出を防ぐ:
  --   - 値は '...'::text の引用符付きリテラルで厳密照合（'not_deliverable' 等の部分一致を弾く）
  --   - 配列の順序は問わない（in ('deliverable','internal') / ('internal','deliverable') 双方可）
  --   - 全体一致なので、3値以上（例 'archived' 追加）や複合式
  --     （例 `status = 'done' OR client_scope = ANY (...)` のように条件付きで任意値を許すもの）は
  --     一致せず落ちる ＝「ちょうど2値に無条件で閉じている」ことを担保
  --   - 先頭が `CHECK ((client_scope` のため、legacy_client_scope 等の別列を参照する制約は
  --     識別子境界で弾かれる（部分文字列一致しない）
  -- また con.convalidated を要求し、NOT VALID の未検証制約（既存行が違反していても通る）は認めない。
  -- （::text キャストと空白は将来の PG バージョン差を吸収するため任意/可変扱い）
  select exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'tasks' and con.contype = 'c'
      and con.convalidated
      and pg_get_constraintdef(con.oid) ~
        '^CHECK\s*\(\(client_scope\s*=\s*ANY\s*\(ARRAY\[\s*(''deliverable''(::text)?\s*,\s*''internal''(::text)?|''internal''(::text)?\s*,\s*''deliverable''(::text)?)\s*\]\)\)\)$'
  ) into v_check_ok;

  if not v_check_ok then
    raise exception 'baseline_client_scope: tasks.client_scope の CHECK 制約が見つからない（deliverable/internal に閉じていない）';
  end if;
end $$;
