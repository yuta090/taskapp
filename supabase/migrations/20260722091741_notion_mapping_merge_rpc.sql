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
-- search_path は空にする（'public' を入れると、同名オブジェクトを別スキーマに作れる立場から
-- SECURITY DEFINER の解決先をすり替えられる余地が残る）。参照は全て public. で完全修飾する。
-- jsonb_* / coalesce 等の組込みは pg_catalog にあり、この設定でも常に解決できる。
set search_path = ''
as $$
declare
  v_org uuid;
  v_provider text;
  v_config jsonb;
  v_mappings jsonb;
  v_containers jsonb;
  v_result jsonb;
begin
  -- for update: この行を今のトランザクションの間ロックする。直後の UPDATE も同じ行を
  -- 対象にするため、ここから UPDATE 完了までの間、他の並行呼び出しはこの行の更新を待たされる
  -- （＝read(ここ)とwrite(下のUPDATE)の間に他の書込が割り込めない）。
  select org_id, provider, import_config into v_org, v_provider, v_config
    from public.integration_connections
    where id = p_connection_id
    for update;

  if v_org is null then
    raise exception 'connection not found';
  end if;

  -- 多層防御: 呼び出し側(API)が org_id で絞っている前提に頼らず、関数内でも一致を確認する。
  -- `<>` ではなく `is distinct from`: p_org_id が NULL だと `v_org <> NULL` は NULL になり
  -- if が偽扱いになって**検証を素通りする**。NULL を「一致しない」として確実に弾く。
  if v_org is distinct from p_org_id then
    raise exception 'connection does not belong to the specified org';
  end if;

  if v_provider is distinct from 'notion' then
    raise exception 'connection is not a notion connection';
  end if;

  -- ---------------------------------------------------------------------------
  -- 既存 jsonb の型検査。**JSONB の null と「キーが無い」は別物**で、`->` は前者に対して
  -- SQL NULL ではなく JSONB の 'null' を返すため coalesce が効かない。その状態で `||` を
  -- 適用すると object ではなく配列状の値が生まれ、しかも UPDATE は成功するので、
  -- APIは200を返し取り込み側だけがマッピングを見つけられず止まる（＝無言の失敗）。
  -- 壊れた既存値は黙って直しも進めもせず、何が不正かを示して明示的に失敗させる。
  -- ---------------------------------------------------------------------------
  if v_config is not null and jsonb_typeof(v_config) <> 'object' then
    raise exception 'import_config is not a JSON object (found %)', jsonb_typeof(v_config)
      using errcode = '22023';
  end if;

  v_mappings := v_config -> 'notion_mappings';
  if v_mappings is not null and jsonb_typeof(v_mappings) <> 'object' then
    raise exception 'import_config.notion_mappings is not a JSON object (found %)', jsonb_typeof(v_mappings)
      using errcode = '22023';
  end if;
  v_mappings := coalesce(v_mappings, '{}'::jsonb);

  v_containers := v_config -> 'read_container_ids';
  if v_containers is not null and jsonb_typeof(v_containers) <> 'array' then
    raise exception 'import_config.read_container_ids is not a JSON array (found %)', jsonb_typeof(v_containers)
      using errcode = '22023';
  end if;
  v_containers := coalesce(v_containers, '[]'::jsonb);

  if not (v_containers @> to_jsonb(array[p_database_id])) then
    v_containers := v_containers || to_jsonb(array[p_database_id]);
  end if;

  -- 上で型を検証済みの値だけを使って組み立てる。for update で行を掴んだままなので、
  -- ここまでの読みとこの UPDATE の間に他の並行呼び出しが割り込むことはない。
  -- 指定された database_id 分のマッピングだけを差し替え、他のキー（target_space_id 等）は
  -- そのまま残す（部分更新。import_config 全体を置換しない）。
  update public.integration_connections
    set import_config = jsonb_set(
      jsonb_set(
        coalesce(v_config, '{}'::jsonb),
        '{notion_mappings}',
        v_mappings || jsonb_build_object(p_database_id, p_mapping),
        true
      ),
      '{read_container_ids}',
      v_containers,
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
