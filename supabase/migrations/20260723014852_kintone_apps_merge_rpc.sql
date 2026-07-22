-- =============================================================================
-- kintone アプリ追加/削除 RPC: rpc_kintone_apps_add / rpc_kintone_apps_remove
-- + rpc_import_config_merge のサーバ管理フィールドに kintone_app_tokens を追加
-- =============================================================================
--
-- 背景（「どのトークンがどのアプリのものか」を保持する形。実装ランナーへの委任事項への回答）:
--   kintoneのAPIトークンはアプリ単位で発行され、接続1行(サブドメイン単位)は
--   access_token_encrypted に**カンマ結合済みの複数トークンをまとめて暗号化した1つのblob**を
--   持つ(providers/kintone/client.ts の buildTokenHeaderValue 参照)。アプリを1つ追加/削除する
--   ためには「どの個々のトークンがどのapp_idのものか」を知る必要があるが、単純なカンマ結合
--   だけでは対応が失われる。
--
--   ここでは import_config.kintone_app_tokens（app_id をキーにした、**アプリ単位で個別に暗号化した
--   トークン**の jsonb オブジェクト）を新設し、これを「どのトークンがどのアプリのものか」の
--   唯一の正本とする。access_token_encrypted（カンマ結合の複合blob。実際にkintoneへ送るヘッダ値の
--   元）は kintone_app_tokens から**都度再計算する派生キャッシュ**とし、アプリの追加/削除のたびに
--   この関数の中で作り直す。
--
--   ⚠ 復号・再結合・再暗号化を Node 側(アプリ層)でやらない理由: 読み(現在のトークン群)→組み立て→
--   書き(access_token_encrypted・kintone_app_ids・kintone_app_tokens)を1つのDBトランザクション・
--   行ロック(for update)の内側に閉じることで、追加/削除の競合(TOCTOU)を構造的に防げる。
--   Node側で読んでから書くまでの間に別の追加/削除が挟まると、古いトークン集合で
--   access_token_encrypted を上書きしてしまう(lost update)。encrypt_system_secret/
--   decrypt_system_secret(20260306_000_system_integration_configs.sql)は素のSQL関数
--   (security definer)なので、この関数の中から直接呼べる。鍵(SYSTEM_ENCRYPTION_KEY)はDBに
--   保存されないため、呼び出し側(API route。getEncryptionKey())が毎回引数で渡す
--   (token-crypto.ts の encryptToken/decryptToken が既にRPC越しに同じ鍵を渡している設計と同じ)。
--
--   ⚠ 既存接続(この機能より前に作られた接続)への配慮: task-sync/route.ts は本PRから、kintone接続の
--   作成時に kintone_app_ids と同じ順序で kintone_app_tokens を必ず一緒に書き込むようにした
--   (作成時は「同じ1リクエストの中で同じ配列から同時に組み立てた」ため、順序対応は仮定ではなく
--   保証された事実になる)。したがって本PR以降に作られたkintone接続は常に両フィールドが揃っている。
--   万一(本PR以前の接続・手動でのDB操作等で)kintone_app_ids にあるのに kintone_app_tokens に
--   対応するエントリが無いapp_idが見つかった場合は、位置(インデックス)で推測してつなぎ直す
--   ようなことはせず、errcode='KTGAP' で明示的に失敗させる(間違ったトークンを別のアプリに
--   紐づけて黙って壊すより、再接続を促すほうが安全なため)。
--
-- 判断（実装ランナーへの委任事項への回答。理由を明記のうえ実装する）:
--   1. 既に登録済みの app_id を rpc_kintone_apps_add で再度追加しようとしたら 409 相当
--      (errcode='KTDUP')で拒否する。トークンの入れ替え(ローテーション)は「削除してから追加」の
--      2手順に委ねる(この関数は「新規追加」だけに責務を絞り、暗黙のローテーションを行わない
--      ことで「うっかり同じapp_idを2回押したら何が起きるか」を予測しやすくする)。
--   2. rpc_kintone_apps_remove は kintone_mappings[app_id] を**削除しない**(残す)。
--      Notion(取り込み対象から外しても確定済みマッピングは残る。read_container_idsから外すだけで
--      notion_mappingsエントリは消さない)と同じ挙動に揃える(providerが違っても「確定済み設定は
--      明示的に触るまで残る」という一貫した振る舞いにするため)。再度同じapp_idを追加すれば
--      (mapping/route.ts経由で)以前のマッピングがそのまま有効になる。
--
-- 不変条件:
--   - p_org_id 引数と接続行の実際の org_id が一致するかを関数内でも確認する(多層防御。
--     20260722230447_kintone_mapping_merge_rpc.sql と同じ)。
--   - 1接続あたりのアプリ数は9件まで(client.ts の MAX_API_TOKENS_PER_REQUEST。
--     X-Cybozu-API-Tokenヘッダの1リクエストあたりの上限と同じ値)。
--   - 最後の1アプリは削除できない(kintone接続は最低1アプリを要求する契約
--     ＝task-sync/route.tsの作成時ゲートと同じ不変条件を、接続のライフサイクル全体で維持する)。
--   - kintone_app_ids の要素比較は string/number どちらの形でも同じ意味で扱う
--     (rpc_kintone_mapping_merge と同じ正規化。#>>'{}' でテキスト化して比較する)。
--
-- 適用: 新規関数の追加＋既存関数(rpc_import_config_merge)の create or replace のみ
-- （列・既存データは変更しない）。アプリ稼働中に適用可。
-- ロールバック（可逆）:
--   drop function public.rpc_kintone_apps_add(uuid, uuid, text, text, text);
--   drop function public.rpc_kintone_apps_remove(uuid, uuid, text, text);
--   rpc_import_config_merge は 20260722233711_import_config_merge_rpc.sql の定義に
--   create or replace で戻す(シグネチャ不変のため上書きで戻せる)。
--   本 RPC 経由で保存済みの import_config / access_token_encrypted は残る(不可逆)。
-- =============================================================================

create or replace function public.rpc_kintone_apps_add(
  p_connection_id uuid,
  p_org_id uuid,
  p_app_id text,
  p_new_token_plaintext text,
  p_encryption_secret text
) returns jsonb
language plpgsql
security definer
-- search_path は空にする(rpc_kintone_mapping_merge と同じ理由。SECURITY DEFINER の解決先を
-- すり替えられる余地を残さない)。参照は全て public. で完全修飾する。
set search_path = ''
as $$
declare
  v_org uuid;
  v_provider text;
  v_config jsonb;
  v_app_ids jsonb;
  v_app_tokens jsonb;
  v_next_app_ids jsonb;
  v_next_app_tokens jsonb;
  v_new_app_token_encrypted text;
  v_combined_plaintext text;
  v_new_combined_encrypted text;
begin
  if p_new_token_plaintext is null or length(p_new_token_plaintext) = 0 then
    raise exception 'p_new_token_plaintext must not be empty';
  end if;

  -- for update: 行ロック。読み(現在のトークン群)〜書き(access_token_encrypted等)を単一トランザクションに閉じる。
  select org_id, provider, import_config into v_org, v_provider, v_config
    from public.integration_connections
    where id = p_connection_id
    for update;

  if v_org is null then
    raise exception 'connection not found';
  end if;

  if v_org is distinct from p_org_id then
    raise exception 'connection does not belong to the specified org';
  end if;

  if v_provider is distinct from 'kintone' then
    raise exception 'connection is not a kintone connection';
  end if;

  if p_app_id !~ '^\d+$' or length(p_app_id) > 20 then
    raise exception 'app_id is not a valid kintone app id (%)', p_app_id
      using errcode = 'KTFMT';
  end if;

  -- 既存 jsonb の型検査(kintone_mapping_merge と同じ流儀。JSONBのnullと「キーが無い」は別物)。
  if v_config is not null and jsonb_typeof(v_config) <> 'object' then
    raise exception 'import_config is not a JSON object (found %)', jsonb_typeof(v_config)
      using errcode = '22023';
  end if;

  v_app_ids := v_config -> 'kintone_app_ids';
  if v_app_ids is not null and jsonb_typeof(v_app_ids) <> 'array' then
    raise exception 'import_config.kintone_app_ids is not a JSON array (found %)', jsonb_typeof(v_app_ids)
      using errcode = '22023';
  end if;
  v_app_ids := coalesce(v_app_ids, '[]'::jsonb);

  v_app_tokens := v_config -> 'kintone_app_tokens';
  if v_app_tokens is not null and jsonb_typeof(v_app_tokens) <> 'object' then
    raise exception 'import_config.kintone_app_tokens is not a JSON object (found %)', jsonb_typeof(v_app_tokens)
      using errcode = '22023';
  end if;
  v_app_tokens := coalesce(v_app_tokens, '{}'::jsonb);

  -- TOCTOU再確認その1: 重複登録(このRPC呼び出し前のAPI層の事前チェックが、その後の疎通確認
  -- (kintoneへの外部API呼び出し)の間に古くなっている可能性がある。行ロック後の最新値で再確認する)。
  if exists (
    select 1 from jsonb_array_elements(v_app_ids) as e(v)
     where jsonb_typeof(e.v) in ('string', 'number')
       and e.v #>> '{}' = p_app_id
  ) then
    raise exception 'app_id % is already registered', p_app_id
      using errcode = 'KTDUP';
  end if;

  -- TOCTOU再確認その2: 上限(9件)。X-Cybozu-API-Tokenヘッダの1リクエストあたりの上限と同じ値
  -- (client.ts の MAX_API_TOKENS_PER_REQUEST)。
  if jsonb_array_length(v_app_ids) >= 9 then
    raise exception 'kintone apps limit (9) reached for this connection'
      using errcode = 'KT9MX';
  end if;

  -- 既存アプリ全ての「対応するトークンが有るか」を確認する(冒頭コメント参照。無ければ
  -- 位置で推測せず明示的に失敗する)。
  if exists (
    select 1 from jsonb_array_elements(v_app_ids) as e(v)
     where jsonb_typeof(e.v) in ('string', 'number')
       and not (v_app_tokens ? (e.v #>> '{}'))
  ) then
    raise exception 'kintone_app_tokens is missing an entry for a registered app_id (reconnect required)'
      using errcode = 'KTGAP';
  end if;

  -- 既存トークン群を app_id 順(kintone_app_ids の並び)で復号し、カンマ結合の平文を組み立てる。
  -- kintoneのAPIトークン照合はヘッダ内の並び順に依存しない(集合として照合される)ため、順序は
  -- 「決定的で再現可能」であることのみを目的とする(テスト容易性)。
  select string_agg(public.decrypt_system_secret(v_app_tokens ->> (e.v #>> '{}'), p_encryption_secret), ',' order by e.ord)
    into v_combined_plaintext
    from jsonb_array_elements(v_app_ids) with ordinality as e(v, ord);

  v_combined_plaintext := case
    when v_combined_plaintext is null or v_combined_plaintext = '' then p_new_token_plaintext
    else v_combined_plaintext || ',' || p_new_token_plaintext
  end;

  v_new_app_token_encrypted := public.encrypt_system_secret(p_new_token_plaintext, p_encryption_secret);
  v_new_combined_encrypted := public.encrypt_system_secret(v_combined_plaintext, p_encryption_secret);

  v_next_app_ids := v_app_ids || to_jsonb(p_app_id);
  v_next_app_tokens := v_app_tokens || jsonb_build_object(p_app_id, v_new_app_token_encrypted);

  update public.integration_connections
    set import_config = jsonb_set(
          jsonb_set(coalesce(v_config, '{}'::jsonb), '{kintone_app_ids}', v_next_app_ids, true),
          '{kintone_app_tokens}', v_next_app_tokens, true
        ),
        access_token_encrypted = v_new_combined_encrypted
    where id = p_connection_id;

  -- 秘密(kintone_app_tokens・access_token_encrypted)は返さない。呼び出し側(API route)が
  -- 必要とするのは更新後の app_ids だけ。
  return jsonb_build_object('app_ids', v_next_app_ids);
end;
$$;

revoke all on function public.rpc_kintone_apps_add(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_kintone_apps_add(uuid, uuid, text, text, text) to service_role;

create or replace function public.rpc_kintone_apps_remove(
  p_connection_id uuid,
  p_org_id uuid,
  p_app_id text,
  p_encryption_secret text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_provider text;
  v_config jsonb;
  v_app_ids jsonb;
  v_app_tokens jsonb;
  v_next_app_ids jsonb;
  v_next_app_tokens jsonb;
  v_combined_plaintext text;
  v_new_combined_encrypted text;
begin
  select org_id, provider, import_config into v_org, v_provider, v_config
    from public.integration_connections
    where id = p_connection_id
    for update;

  if v_org is null then
    raise exception 'connection not found';
  end if;

  if v_org is distinct from p_org_id then
    raise exception 'connection does not belong to the specified org';
  end if;

  if v_provider is distinct from 'kintone' then
    raise exception 'connection is not a kintone connection';
  end if;

  if p_app_id !~ '^\d+$' or length(p_app_id) > 20 then
    raise exception 'app_id is not a valid kintone app id (%)', p_app_id
      using errcode = 'KTFMT';
  end if;

  if v_config is not null and jsonb_typeof(v_config) <> 'object' then
    raise exception 'import_config is not a JSON object (found %)', jsonb_typeof(v_config)
      using errcode = '22023';
  end if;

  v_app_ids := v_config -> 'kintone_app_ids';
  if v_app_ids is not null and jsonb_typeof(v_app_ids) <> 'array' then
    raise exception 'import_config.kintone_app_ids is not a JSON array (found %)', jsonb_typeof(v_app_ids)
      using errcode = '22023';
  end if;
  v_app_ids := coalesce(v_app_ids, '[]'::jsonb);

  v_app_tokens := v_config -> 'kintone_app_tokens';
  if v_app_tokens is not null and jsonb_typeof(v_app_tokens) <> 'object' then
    raise exception 'import_config.kintone_app_tokens is not a JSON object (found %)', jsonb_typeof(v_app_tokens)
      using errcode = '22023';
  end if;
  v_app_tokens := coalesce(v_app_tokens, '{}'::jsonb);

  -- TOCTOU再確認: 対象app_idが(行ロック後の最新値で見て)登録済みか。
  if not exists (
    select 1 from jsonb_array_elements(v_app_ids) as e(v)
     where jsonb_typeof(e.v) in ('string', 'number')
       and e.v #>> '{}' = p_app_id
  ) then
    raise exception 'app_id % is not registered', p_app_id
      using errcode = 'KTNF';
  end if;

  -- 不変条件: 接続は最低1アプリを持つ(task-sync/route.tsの作成時ゲートと同じ制約を、
  -- 接続のライフサイクル全体で維持する。0件にすると「保存はできるが取り込みが永久に
  -- 始まらない死んだ接続」に逆戻りしてしまう)。
  if jsonb_array_length(v_app_ids) <= 1 then
    raise exception 'cannot remove the last remaining app from a kintone connection'
      using errcode = 'KTLAST';
  end if;

  select coalesce(jsonb_agg(e.v order by e.ord), '[]'::jsonb)
    into v_next_app_ids
    from jsonb_array_elements(v_app_ids) with ordinality as e(v, ord)
   where (e.v #>> '{}') <> p_app_id;

  v_next_app_tokens := v_app_tokens - p_app_id;

  -- 残るアプリ全ての対応トークンが有るか確認する(add側と同じ理由の防御)。
  if exists (
    select 1 from jsonb_array_elements(v_next_app_ids) as e(v)
     where jsonb_typeof(e.v) in ('string', 'number')
       and not (v_next_app_tokens ? (e.v #>> '{}'))
  ) then
    raise exception 'kintone_app_tokens is missing an entry for a registered app_id (reconnect required)'
      using errcode = 'KTGAP';
  end if;

  select string_agg(public.decrypt_system_secret(v_next_app_tokens ->> (e.v #>> '{}'), p_encryption_secret), ',' order by e.ord)
    into v_combined_plaintext
    from jsonb_array_elements(v_next_app_ids) with ordinality as e(v, ord);

  -- 上の KTLAST チェックで残り1件以上を保証済みのため、v_combined_plaintext が NULL になることは無い。
  v_new_combined_encrypted := public.encrypt_system_secret(v_combined_plaintext, p_encryption_secret);

  -- ⚠ 判断(冒頭コメント参照): kintone_mappings[p_app_id] はここでは触らない(削除しない)。
  -- Notionの「取り込みをやめても確定済みマッピングは残る」挙動に揃える。
  update public.integration_connections
    set import_config = jsonb_set(
          jsonb_set(coalesce(v_config, '{}'::jsonb), '{kintone_app_ids}', v_next_app_ids, true),
          '{kintone_app_tokens}', v_next_app_tokens, true
        ),
        access_token_encrypted = v_new_combined_encrypted
    where id = p_connection_id;

  return jsonb_build_object('app_ids', v_next_app_ids);
end;
$$;

revoke all on function public.rpc_kintone_apps_remove(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_kintone_apps_remove(uuid, uuid, text, text) to service_role;

-- =============================================================================
-- rpc_import_config_merge の再定義: kintone_app_tokens をサーバ管理フィールドに追加する
-- =============================================================================
--
-- なぜ必要か（具体的に踏みうる事故）: 汎用の取り込み設定エディタ(ImportConfigEditor.tsx)は
-- target_space_id 等を変更する際に `{ ...connection.importConfig, target_space_id: value }` と
-- **現在のimport_config全体をスプレッドして送る**(既存の実装パターン。NotionImportPanel.tsxの
-- read_container_ids解除でも同じパターンが使われている)。kintone接続でもこのエディタは
-- そのまま使われる(TaskSyncConnectPanel/KintoneConnectPanelがprovider問わず描画する)ため、
-- 何もしなければ「target_space_idを変更しただけ」のPATCHが、その時点でクライアントが
-- 持っていた(古いかもしれない)kintone_app_tokensをそのまま送り返し、並行して走った
-- rpc_kintone_apps_add/removeの結果を上書きして消してしまう(lost update)。
-- notion_mappings/kintone_mappings/kintone_app_idsと同じ理由でこのキーも汎用PATCHの対象外にする。
--
-- ⚠ TSとSQLの配列一致は src/__tests__/lib/task-sync/mappingDbGuards.test.ts が固定する
-- (このファイルを最新の定義として参照するよう更新済み)。
--
-- 本体(for update・型検査・部分更新セマンティクス)は 20260722233711_import_config_merge_rpc.sql
-- と同一。変更点は c_server_managed_keys 配列に 'kintone_app_tokens' を追加した1点のみ。
-- =============================================================================

create or replace function public.rpc_import_config_merge(
  p_connection_id uuid,
  p_patch jsonb,
  p_import_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_server_managed_keys constant text[] := array['notion_mappings', 'kintone_mappings', 'kintone_app_ids', 'kintone_app_tokens'];
  v_config jsonb;
  v_patch jsonb;
  v_next jsonb;
  v_result jsonb;
begin
  select import_config into v_config
    from public.integration_connections
    where id = p_connection_id
    for update;

  if not found then
    raise exception 'connection not found' using errcode = 'P0002';
  end if;

  if v_config is not null and jsonb_typeof(v_config) <> 'object' then
    raise exception 'import_config is not a JSON object (found %)', jsonb_typeof(v_config)
      using errcode = '22023';
  end if;

  if p_patch is not null and jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch is not a JSON object (found %)', jsonb_typeof(p_patch)
      using errcode = '22023';
  end if;

  v_patch := coalesce(p_patch, '{}'::jsonb) - c_server_managed_keys;

  v_next := coalesce(v_config, '{}'::jsonb);

  v_next := v_next || (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from jsonb_each(v_patch) as e
     where jsonb_typeof(e.value) <> 'null'
  );

  v_next := v_next - (
    select coalesce(array_agg(e.key), array[]::text[])
      from jsonb_each(v_patch) as e
     where jsonb_typeof(e.value) = 'null'
  );

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
  'import_config の部分更新（指定キーのみ上書き / JSON null は削除）。notion_mappings・kintone_mappings・kintone_app_ids・kintone_app_tokens は変更しない。行ロック内で読み書きするため汎用PATCHとマッピング/アプリ管理RPCの lost update が起きない。';

revoke all on function public.rpc_import_config_merge(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.rpc_import_config_merge(uuid, jsonb, boolean) to service_role;
