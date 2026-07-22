-- =============================================================================
-- 汎用 import_config 部分更新 RPC: rpc_import_config_merge
-- =============================================================================
--
-- 背景（lost update）:
--   汎用PATCH（src/app/api/integrations/connections/[id]/import-config/route.ts）は
--   「現在値を読む → import_config 全体を組み立てる → 置換」という read-modify-write だった。
--   読みと書きの間にマッピング保存RPC（rpc_notion_mapping_merge / rpc_kintone_mapping_merge）が
--   走ると、PATCH が**読んだ時点の古い mappings を書き戻して、確定したばかりのマッピングを消す**。
--   マッピングは「AI提案＋人が1回確認」でしか作れない高コストな確定データなので、静かに消えるのは
--   実害が大きい（しかも消えたことに気づく手段が無い）。
--   → 20260722091741_notion_mapping_merge_rpc.sql と同じ処方: 読みと書きを1トランザクション・
--     行ロックの内側に閉じ、アプリ層で import_config 全体を組み立てるのをやめる。
--
-- セマンティクス（部分更新）:
--   - p_patch に**含まれるキーだけ**を書き換える。含まれないキーは現在値のまま残す。
--   - p_patch のキーの値が JSON null なら「そのキーを削除する」＝未設定に戻す。
--     （UI 側の pruneImportConfig は空文字/空配列を null にして送る。従来は「キーを送らない＝未設定」
--       だったが、部分更新では「送らない＝現在値維持」と区別できないため、**未設定は明示的な null**で
--       表現する契約に変えた。DB上の形は従来どおり「キーが無い＝未設定」で不変。）
--   - p_import_enabled が NULL なら import_enabled は変更しない（省略＝据え置き）。
--
-- ⚠ サーバ管理フィールドはこのRPCでは絶対に変更しない:
--     notion_mappings / kintone_mappings / kintone_app_ids
--   p_patch に含まれていても無視する（400で弾かずに黙って落とす理由は route.ts のコメント参照:
--   現在値をそのまま送り返す正当な実装のクライアントまで壊してしまうため）。
--   これらは「ライブスキーマを再取得して検証した結果」または「アプリIDとAPIトークンをセットで
--   登録する専用経路」でしか作れない確定データであり、汎用PATCHから触れると
--   (a) 検証の迂回 (b) 確定済み設定の消失 の2事故が起きる。
--   ⚠ 20260722233606_protect_task_sync_mappings.sql のトリガーとの整合:
--     本関数は service_role からしか実行できず、かつ mappings を一切書き換えない（現在値のまま
--     残す）ので、あのトリガーの「変更されていなければ素通し」条件で必ず通る。
--     つまり **auth.role() が definer 内でどう見えるかに依存しない**（definer は current_user を
--     変えるだけで request.jwt.claims / role GUC を変えないため service_role のままだが、
--     仮にその見え方が将来変わっても、本関数は mappings を変更しないので破綻しない）。
--
-- 適用: 新規関数のみ（列・既存オブジェクト不変）。アプリ稼働中に適用可。
-- ロールバック（可逆）:
--   drop function public.rpc_import_config_merge(uuid, jsonb, boolean);
--   ただし route.ts を旧 read-modify-write に戻さないと汎用PATCHが 500 になる（コード側と対で戻す）。
--   本RPC経由で保存済みの import_config は残る（データは削除しない＝保存結果は不可逆）。
-- =============================================================================

create or replace function public.rpc_import_config_merge(
  p_connection_id uuid,
  p_patch jsonb,
  p_import_enabled boolean
) returns jsonb
language plpgsql
security definer
-- search_path は空にする（'public' を入れると、同名オブジェクトを別スキーマに作れる立場から
-- SECURITY DEFINER の解決先をすり替えられる余地が残る）。参照は全て public. で完全修飾する。
set search_path = ''
as $$
declare
  -- 汎用PATCHでは絶対に変更しないサーバ管理フィールド（理由は冒頭コメント）。
  c_server_managed_keys constant text[] := array['notion_mappings', 'kintone_mappings', 'kintone_app_ids'];
  v_config jsonb;
  v_patch jsonb;
  v_next jsonb;
  v_result jsonb;
begin
  -- for update: 行を掴んでから読む。直後の UPDATE も同じ行なので、読みと書きの間に他の並行書込
  -- （マッピング保存RPC等）が割り込めない＝lost update が構造的に起きない。
  select import_config into v_config
    from public.integration_connections
    where id = p_connection_id
    for update;

  if not found then
    -- no_data_found。API 側はこれを 404 に写像する（P0001 の検証エラーと区別するため）。
    raise exception 'connection not found' using errcode = 'P0002';
  end if;

  -- ---------------------------------------------------------------------------
  -- jsonb 型検査（20260722091741_notion_mapping_merge_rpc.sql と同じ流儀・同じ errcode）。
  -- JSONB の null と「キーが無い」は別物で、`->` は前者に SQL NULL ではなく jsonb 'null' を返す。
  -- 壊れた既存値は黙って直しも進めもせず、何が不正かを示して明示的に失敗させる。
  -- ---------------------------------------------------------------------------
  if v_config is not null and jsonb_typeof(v_config) <> 'object' then
    raise exception 'import_config is not a JSON object (found %)', jsonb_typeof(v_config)
      using errcode = '22023';
  end if;

  if p_patch is not null and jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch is not a JSON object (found %)', jsonb_typeof(p_patch)
      using errcode = '22023';
  end if;

  -- サーバ管理フィールドは受け取っても捨てる（多層防御: route.ts 側でも落としているが、
  -- 呼び出し経路が増えても構造的に守られるようにここでも落とす）。
  v_patch := coalesce(p_patch, '{}'::jsonb) - c_server_managed_keys;

  v_next := coalesce(v_config, '{}'::jsonb);

  -- 値が JSON null 以外のキー: その値で上書き（キーが無ければ追加）。
  v_next := v_next || (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from jsonb_each(v_patch) as e
     where jsonb_typeof(e.value) <> 'null'
  );

  -- 値が JSON null のキー: 削除＝未設定に戻す（DB上の形を「キーが無い＝未設定」で保つ）。
  v_next := v_next - (
    select coalesce(array_agg(e.key), array[]::text[])
      from jsonb_each(v_patch) as e
     where jsonb_typeof(e.value) = 'null'
  );

  -- p_patch に現れなかったキー（notion_mappings 等のサーバ管理フィールドを含む）は
  -- v_next の元になった v_config にそのまま残っている＝一切変更されない。
  -- 別名 ic を付けるのは、p_import_enabled が NULL のとき「現在値を据え置く」ために
  -- 更新対象行の**旧**値を曖昧さなく参照するため（ic.import_enabled）。
  update public.integration_connections as ic
    set import_config = v_next,
        import_enabled = coalesce(p_import_enabled, ic.import_enabled)
    where ic.id = p_connection_id
    returning jsonb_build_object(
      'id', ic.id,
      'import_config', ic.import_config,
      'import_enabled', ic.import_enabled
    ) into v_result;

  return v_result;
end;
$$;

comment on function public.rpc_import_config_merge(uuid, jsonb, boolean) is
  'import_config の部分更新（指定キーのみ上書き / JSON null は削除）。notion_mappings・kintone_mappings・kintone_app_ids は変更しない。行ロック内で読み書きするため汎用PATCHとマッピング保存RPCの lost update が起きない。';

-- 権限: 新規 SECURITY DEFINER 関数の EXECUTE は既定で PUBLIC に付くため、明示 revoke しないと
-- anon/authenticated が直接叩ける。呼び出すのは汎用PATCH API(service_role)のみ。
revoke all on function public.rpc_import_config_merge(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.rpc_import_config_merge(uuid, jsonb, boolean) to service_role;
