-- =============================================================================
-- Notion マッピング保存 RPC: rpc_notion_mapping_merge
-- =============================================================================
--
-- 背景（read-modify-write の last-writer-wins 問題）:
--   マッピング確認保存API(/api/integrations/connections/notion/mapping)は、接続行を読み、
--   Notion APIへスキーマ再取得を挟んでから、読んだ時点の import_config を元に
--   `import_config = { ...currentConfig, notion_mappings: {...}, read_container_ids: [...] }`
--   という形で丸ごと UPDATE していた。2つの Notion データベースのマッピングをほぼ同時に
--   保存すると、両方とも「保存直前の import_config」を読んだ古いスナップショットを基に
--   置換するため、後に UPDATE したリクエストが先の保存結果を消してしまう
--   （read → 外部API呼び出し(遅延が乗る) → write の間に他の書込が挟まる典型的な
--   read-modify-write レース）。
--
-- 修正方針:
--   import_config.notion_mappings[database_id] の更新と read_container_ids への
--   database_id 追加（重複なし）を、**1回の UPDATE 文の中で jsonb 演算として**完結させる。
--   PostgreSQL の単一 UPDATE 文は対象行に行ロックを取ってから式を評価するため、
--   「読んで→組み立てて→書く」をアプリ層で分割する必要が無くなり、並行保存でも
--   互いの notion_mappings エントリを消し合わない（後続の UPDATE は先行 UPDATE がコミットする
--   まで待たされ、待った後は先行 UPDATE 済みの値を元に演算する）。
--
-- 多層防御（呼び出し側の検証に頼らない）:
--   保存APIは既に (id, org_id, provider='notion') で接続行を絞ってから呼ぶが、本関数は
--   その前提を信用せず、p_org_id 引数と接続行の実際の org_id が一致するかを関数内でも
--   確認し、不一致なら例外にする（呼び出し経路が増えても越境を構造的に防ぐ）。
--
-- 不変条件:
--   - notion_mappings の他の database_id のエントリ、import_config の他のキー
--     （target_space_id 等）は一切変更しない（部分更新）。
--   - read_container_ids に database_id が既に含まれる場合は追加しない（重複なし）。
--   - 検証済みの mapping（parseNotionMapping + validateMappingAgainstSchema を通過済み）を
--     呼び出し側が渡す前提。本関数自身はマッピングの中身（prop_id 等）を検証しない
--     （ライブスキーマ検証はDBの責務ではなくAPI層の責務のまま）。
--
-- 適用: 新規関数のみ（列・既存オブジェクト不変）。アプリ稼働中に適用可。
-- ロールバック（可逆）:
--   drop function public.rpc_notion_mapping_merge(uuid, uuid, text, jsonb);
--   本 RPC 経由で保存済みの import_config は残る（データは削除しない＝保存結果は不可逆）。
-- =============================================================================

create or replace function public.rpc_notion_mapping_merge(
  p_connection_id uuid,
  p_org_id uuid,
  p_database_id text,
  p_mapping jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_provider text;
  v_result jsonb;
begin
  -- for update: この行を今のトランザクションの間ロックする。直後の UPDATE も同じ行を
  -- 対象にするため、ここから UPDATE 完了までの間、他の並行呼び出しはこの行の更新を待たされる
  -- （＝read(ここ)とwrite(下のUPDATE)の間に他の書込が割り込めない）。
  select org_id, provider into v_org, v_provider
    from public.integration_connections
    where id = p_connection_id
    for update;

  if v_org is null then
    raise exception 'connection not found';
  end if;

  -- 多層防御: 呼び出し側(API)が org_id で絞っている前提に頼らず、関数内でも一致を確認する。
  if v_org <> p_org_id then
    raise exception 'connection does not belong to the specified org';
  end if;

  if v_provider <> 'notion' then
    raise exception 'connection is not a notion connection';
  end if;

  update public.integration_connections
    set import_config = jsonb_set(
      jsonb_set(
        coalesce(import_config, '{}'::jsonb),
        '{notion_mappings}',
        coalesce(import_config->'notion_mappings', '{}'::jsonb)
          || jsonb_build_object(p_database_id, p_mapping),
        true
      ),
      '{read_container_ids}',
      case
        when coalesce(import_config->'read_container_ids', '[]'::jsonb) @> to_jsonb(array[p_database_id])
          then coalesce(import_config->'read_container_ids', '[]'::jsonb)
        else coalesce(import_config->'read_container_ids', '[]'::jsonb) || to_jsonb(array[p_database_id])
      end,
      true
    )
    where id = p_connection_id
    returning import_config into v_result;

  return v_result;
end;
$$;

-- 権限: 新規 SECURITY DEFINER 関数の EXECUTE は既定で PUBLIC に付くため、明示 revoke しないと
-- anon/authenticated が直接叩ける。呼び出すのは保存API(service_role)のみ。
revoke all on function public.rpc_notion_mapping_merge(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_notion_mapping_merge(uuid, uuid, text, jsonb) to service_role;
