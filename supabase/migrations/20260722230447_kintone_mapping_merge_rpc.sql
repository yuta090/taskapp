-- =============================================================================
-- kintone マッピング保存 RPC: rpc_kintone_mapping_merge
-- =============================================================================
--
-- 背景・設計方針は 20260722091741_notion_mapping_merge_rpc.sql と同じ（read-modify-write の
-- last-writer-wins 問題を、jsonbの該当部分だけをDB側で原子的にマージすることで防ぐ）。
--
-- ⚠ Notion との違い（この関数を単純にしている理由）:
--   kintone には Notion の read_container_ids に相当する「保存時にこのRPCが追記すべき
--   コンテナ一覧」が無い。kintone_app_ids（どのアプリをポーリング対象にするか）は接続作成/編集の
--   専用経路（src/app/api/integrations/connections/task-sync/route.ts）でのみ管理される別の設定
--   であり、マッピング確認保存はそこに触れない（マッピングを保存しても、そのアプリがまだ
--   kintone_app_ids に無ければポーリング対象には含まれないまま＝これは意図した挙動。
--   アプリの追加/削除は接続編集の責務、マッピングの確認/保存はこのRPCの責務、と役割を分ける）。
--   そのため本関数がマージするのは import_config.kintone_mappings[app_id] のみで良い。
--
-- 多層防御（呼び出し側の検証に頼らない）:
--   保存APIは既に (id, org_id, provider='kintone') で接続行を絞ってから呼ぶが、本関数は
--   その前提を信用せず、p_org_id 引数と接続行の実際の org_id が一致するかを関数内でも
--   確認し、不一致なら例外にする（呼び出し経路が増えても越境を構造的に防ぐ）。
--
-- 不変条件:
--   - kintone_mappings の他の app_id のエントリ、import_config の他のキー
--     （kintone_app_ids・target_space_id 等）は一切変更しない（部分更新）。
--   - 検証済みの mapping（parseKintoneMapping + validateMappingAgainstSchema を通過済み）を
--     呼び出し側が渡す前提。本関数自身はマッピングの中身（field_code 等）を検証しない
--     （ライブスキーマ検証はDBの責務ではなくAPI層の責務のまま）。
--   - p_app_id は**この関数が行ロックを取った時点の** import_config.kintone_app_ids に
--     登録済みであること（下記 TOCTOU 対策）。
--
-- ⚠ TOCTOU（保存APIの事前チェックが古くなる問題）:
--   保存API(kintone/mapping/route.ts)は「app_id が kintone_app_ids に登録済みか」を
--   **kintone へのスキーマ再取得(外部API呼び出し)の前**に確認する。その外部呼び出しの間に
--   接続編集(task-sync/route.ts 等)で当該アプリが kintone_app_ids から外されると、RPC 到達時には
--   事前チェックの結果が古くなっている。そのまま保存すると、ポーリング対象に永久に含まれない
--   「死んだマッピング」が生まれる（fable裁定 2026-07-22 で拒否と決めた状態そのもの）。
--   → for update で行を掴んだ**後**に、最新の kintone_app_ids で再確認する。
--
-- 適用: 新規関数のみ（列・既存オブジェクト不変）。アプリ稼働中に適用可。
-- ロールバック（可逆）:
--   drop function public.rpc_kintone_mapping_merge(uuid, uuid, text, jsonb);
--   本 RPC 経由で保存済みの import_config は残る（データは削除しない＝保存結果は不可逆）。
-- =============================================================================

create or replace function public.rpc_kintone_mapping_merge(
  p_connection_id uuid,
  p_org_id uuid,
  p_app_id text,
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
  v_app_ids jsonb;
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

  if v_provider is distinct from 'kintone' then
    raise exception 'connection is not a kintone connection';
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

  v_mappings := v_config -> 'kintone_mappings';
  if v_mappings is not null and jsonb_typeof(v_mappings) <> 'object' then
    raise exception 'import_config.kintone_mappings is not a JSON object (found %)', jsonb_typeof(v_mappings)
      using errcode = '22023';
  end if;
  v_mappings := coalesce(v_mappings, '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- TOCTOU 対策: 行ロック取得後の最新値で「app_id が登録済みか」を再確認する（冒頭コメント参照）。
  --
  -- ⚠ 正規化の意味は normalizeKintoneAppIds(src/lib/task-sync/providers/kintone/mapping.ts)と
  --   揃える。揃っていないと「アプリ側では登録済みなのにRPCが拒否する」食い違いになる:
  --     - 配列でなければ「1件も登録されていない」とみなす（TS: Array.isArray でなければ []）
  --     - 要素は **JSON の文字列と数値の双方**を同じ意味で扱う（TS: number は String() で文字列化）。
  --       jsonb の `#>> '{}'` は string/number どちらもテキストにするため、両者を等価に比較できる。
  --     - 妥当なアプリID形式（^\d+$ かつ20桁以内。TS: isValidKintoneAppId）以外は無視する。
  --       p_app_id 側も同じ形式を要求することで、「不正な要素は無視する」TS の挙動と一致する
  --       （不正な要素は妥当な p_app_id と等しくなり得ないため、無視と同義）。
  -- ---------------------------------------------------------------------------
  if p_app_id !~ '^\d+$' or length(p_app_id) > 20 then
    raise exception 'app_id is not a valid kintone app id (%)', p_app_id
      using errcode = 'KTAPP';
  end if;

  v_app_ids := v_config -> 'kintone_app_ids';
  if v_app_ids is not null and jsonb_typeof(v_app_ids) <> 'array' then
    raise exception 'import_config.kintone_app_ids is not a JSON array (found %)', jsonb_typeof(v_app_ids)
      using errcode = '22023';
  end if;

  -- errcode は 22023（＝既存の「import_config が壊れている」）と分ける。ここは設定が壊れているのでは
  -- なく「先にアプリIDとAPIトークンを登録すれば解決する」運用上の順序の問題であり、API 側は
  -- 別メッセージ・別ステータス(400)に写像する必要があるため。'KTAPP' はカスタム SQLSTATE
  -- （既存の 'DUEXT'（20260721133427_due_reminder_pr0.sql）と同じ流儀）。
  if not exists (
    select 1
      from jsonb_array_elements(coalesce(v_app_ids, '[]'::jsonb)) as e(v)
     where jsonb_typeof(e.v) in ('string', 'number')
       and e.v #>> '{}' = p_app_id
  ) then
    raise exception 'app_id % is not registered in import_config.kintone_app_ids', p_app_id
      using errcode = 'KTAPP';
  end if;

  -- 上で型を検証済みの値だけを使って組み立てる。for update で行を掴んだままなので、
  -- ここまでの読みとこの UPDATE の間に他の並行呼び出しが割り込むことはない。
  -- 指定された app_id 分のマッピングだけを差し替え、他のキー（kintone_app_ids等）は
  -- そのまま残す（部分更新。import_config 全体を置換しない）。
  update public.integration_connections
    set import_config = jsonb_set(
      coalesce(v_config, '{}'::jsonb),
      '{kintone_mappings}',
      v_mappings || jsonb_build_object(p_app_id, p_mapping),
      true
    )
    where id = p_connection_id
    returning import_config into v_result;

  return v_result;
end;
$$;

-- 権限: 新規 SECURITY DEFINER 関数の EXECUTE は既定で PUBLIC に付くため、明示 revoke しないと
-- anon/authenticated が直接叩ける。呼び出すのは保存API(service_role)のみ。
revoke all on function public.rpc_kintone_mapping_merge(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_kintone_mapping_merge(uuid, uuid, text, jsonb) to service_role;
