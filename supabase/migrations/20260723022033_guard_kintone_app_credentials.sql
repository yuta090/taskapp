-- =============================================================================
-- ガードの保護範囲拡大: import_config.kintone_app_tokens / kintone_app_ids も守る
-- =============================================================================
--
-- 何を変えるか（1点だけ）:
--   既存のガード関数 public.integration_connections_guard_mappings() を create or replace し、
--   保護対象キーに **kintone_app_tokens** と **kintone_app_ids** を加える。
--   判定ロジック（service_role 素通し・変更なし UPDATE 素通し・INSERT 拒否）は 20260722233606_
--   protect_task_sync_mappings.sql と完全に同一で、見るキーが増えるだけ。
--
-- なぜ必要か（筋が通っていない状態の是正）:
--   20260722233606 は notion_mappings / kintone_mappings（＝「どのプロパティが期日か」の対応表）を
--   守った。しかし kintone のアプリ管理（20260723014852_kintone_apps_merge_rpc.sql）で増えた
--   次の2キーは、**マッピングより機微なのに素通し**だった。
--     - kintone_app_tokens … { app_id: アプリ単位で個別に暗号化した kintone APIトークン }。
--       これが「どのトークンがどのアプリのものか」の**正本**であり、実際に kintone へ送る
--       ヘッダ値 access_token_encrypted（カンマ結合の複合blob）は rpc_kintone_apps_add/remove が
--       行ロックの内側でこの正本から**都度再計算する派生キャッシュ**にすぎない。
--     - kintone_app_ids … 取り込み対象アプリの正本（どのアプリをポーリングするか）。
--
--   RLS の "users can update own connections"（20260214_000_integration_connections.sql）は
--   owner_type='org' なら role='owner' の org member に UPDATE を許すため、org owner は
--   ブラウザの authenticated supabase-js から integration_connections を直接 UPDATE できる。
--   このとき現状では次が通ってしまう:
--     (1) kintone_app_tokens を任意の文字列で書き換える
--         → 直後の rpc_kintone_apps_add/remove が「正本」としてそれを復号しようとし、
--           access_token_encrypted を壊れた値で作り直す＝その接続の取り込みが恒久停止する
--           （復号に失敗すれば KTGAP/例外で止まり、成功する形の別トークンを注入されれば
--            その接続が意図しない相手のアプリを叩きうる）。
--     (2) kintone_app_ids に未登録のアプリIDを足す
--         → rpc_kintone_mapping_merge の「登録済みアプリか」の再確認（errcode='KTAPP'。
--           20260722230447）を素通しでき、アプリ追加API（トークン検証・9件上限・疎通確認）を
--           完全に迂回して取り込み対象を増やせる。逆に消せば取り込みを静かに止められる。
--   マッピングを守ってこの2つを守らないのは、同じ穴の一部だけを塞いだ状態。同じ理由・同じ構造で
--   塞ぐ（RLS＝**誰が**書けるか / トリガー＝**何を**書けるか、の責務分離）。
--
-- なぜ関数の差し替えだけで、トリガーは作り直さないのか:
--   トリガー integration_connections_guard_mappings は既に本番で稼働しており、関数名・シグネチャ
--   （引数なし・returns trigger）は変えない。トリガーは関数を**名前ではなく OID で参照**するが、
--   create or replace は OID を保持したまま本体だけを差し替えるため、既存トリガーは自動的に新しい
--   本体を実行する。drop/create trigger は不要（作り直すと、その一瞬だけガードが外れる窓が
--   できるうえ、本番のトリガー定義との対応が無意味に揺れる）。
--
--   ⚠ 関数名を変えない判断: 中身が「mappings だけでなく kintone のアプリ資格情報も守る」に
--   広がるため関数名は実態と少しズレるが、**改名しない**。改名すると本番で稼働中のトリガー定義
--   （旧名の関数を指す）との対応が切れ、トリガーの張り替え（drop→create）が必須になる＝上記の
--   「ガードが外れる窓」を、名前の見栄えのためだけに作ることになる。実態は下の comment on function
--   とこのヘッダで明示する（安全側＝改名しない）。
--
-- ロール判定（20260722233606 から一切変えない）:
--   auth.role() = 'service_role' or current_setting('role', true) = 'service_role' の OR。
--   このリポジトリの既存2系統（(a) JWT の role claim / (b) PostgREST が張る SET LOCAL ROLE）の
--   どちらの流儀でも通るようにするため。独自判定は発明しない。理由の詳細は
--   20260722233606_protect_task_sync_mappings.sql のヘッダを参照。
--   運用（psql からの保守）: JWT の無い psql は auth.role() が NULL のため、これらのキーを直す
--   保守SQLは `set local role service_role;` を先に実行すること（(b) で通る）。
--
-- 正規の経路が壊れないことの裏取り（**全て service_role**。1つでも authenticated があれば壊れる）:
--   - 接続作成 POST /api/integrations/connections/task-sync
--       src/app/api/integrations/connections/task-sync/route.ts:190 `createAdminClient()` →
--       :191-215 INSERT（:211-214 で import_config に kintone_app_ids と kintone_app_tokens を書く）
--   - アプリ追加/削除 POST|DELETE /api/integrations/connections/kintone/apps
--       src/app/api/integrations/connections/kintone/apps/route.ts:185-192 `createAdminClient()`
--       → rpc_kintone_apps_add、:258-264 `createAdminClient()` → rpc_kintone_apps_remove
--       （両 RPC は security definer かつ EXECUTE が service_role のみ。RPC 内の UPDATE でも
--         auth.role() は呼び出し元 JWT の 'service_role' のままなのでこのガードを素通しする）
--   - 汎用 PATCH /api/integrations/connections/[id]/import-config
--       route.ts:103-104 で IMPORT_CONFIG_SERVER_MANAGED_KEYS（kintone_app_ids /
--       kintone_app_tokens を含む）を落とし、:106 `createAdminClient()` → rpc_import_config_merge
--       （RPC 側でも c_server_managed_keys で再度落とす）。そもそもこれらのキーを書かない。
--   - マッピング保存 notion/kintone mapping route、engine の saveCursor
--       （src/lib/task-sync/store.ts:216-224 / :230-234。クライアントは runner.ts:16-25 の
--         SUPABASE_SERVICE_ROLE_KEY 製）、OAuth コールバック
--       （src/app/api/integrations/callback/[provider]/route.ts:17-24 の service_role クライアント）
--       … いずれも import_config の kintone 系キーを一切書かない（saveCursor は poll_cursor /
--         last_import_success_at / import_missing_containers のみ＝「変更なし UPDATE」の
--         ホットパスで素通し）。
--   ブラウザ（authenticated）から integration_connections へ書く経路は存在しない
--   （src/components/**・src/lib/hooks/** に .from('integration_connections') の書込は無く、
--    UI は全て上記 API 経由）。
--
-- 既存データへの影響: 無し（このトリガーはデータを書き換えない）。既に不正な値を持つ行があっても、
--   その行を UPDATE するとき「該当キーを変更しようとした場合だけ」拒否する。該当キーを変更しない
--   UPDATE（トークンリフレッシュ・status・target_space_id・last_import_success_at 等）は素通し。
--
-- 適用: 関数本体の差し替えのみ（列・データ・トリガー定義は変更なし）。アプリ稼働中に適用可。
-- ロールバック（可逆）:
--   20260722233606_protect_task_sync_mappings.sql の関数定義を create or replace で流し直せば
--   元の保護範囲（mappings のみ）に戻る。シグネチャ不変のためトリガーの張り替えは不要。
--   不可逆なものは無い（データを書き換えないため）。ただし戻すと上記(1)(2)の迂回経路が再び開く。
-- =============================================================================

create or replace function public.integration_connections_guard_mappings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- service_role（保存API・アプリ追加/削除RPC・汎用PATCH RPC・import worker 等の
  -- createAdminClient 経由）は素通し。2系統の判定を OR で見る理由はヘッダ参照。
  if auth.role() = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- ホットパス: import_config を変更しない UPDATE（トークンリフレッシュ・status 更新・
  -- saveCursor 等）はそもそも判定不要。is not distinct from で NULL 同士も等価扱いにする。
  if tg_op = 'UPDATE' and new.import_config is not distinct from old.import_config then
    return new;
  end if;

  -- INSERT: これらのキーを含む行を非 service_role が作れないようにする
  -- （UPDATE だけ塞ぐと「削除して作り直す」で同じ注入ができてしまうため、直接INSERTも塞ぐ）。
  -- `-> ` は「キーが無い」なら SQL NULL、「キーがあって値が JSON null」なら jsonb 'null' を返すので、
  -- is not null で「キーの存在」を判定できる（jsonb ? 演算子を使わないのは、`?` を
  -- プレースホルダとして解釈しうるクライアントから流し込まれても壊れないようにするため）。
  if tg_op = 'INSERT' then
    if (new.import_config -> 'notion_mappings') is not null
       or (new.import_config -> 'kintone_mappings') is not null then
      raise exception
        'import_config.notion_mappings / kintone_mappings はサーバの検証済み経路（マッピング保存API）からのみ変更できます';
    end if;
    if (new.import_config -> 'kintone_app_tokens') is not null
       or (new.import_config -> 'kintone_app_ids') is not null then
      raise exception
        'import_config.kintone_app_tokens / kintone_app_ids はサーバの専用経路（接続作成API・アプリ追加/削除API）からのみ変更できます';
    end if;
    return new;
  end if;

  -- UPDATE: 「旧値と新値でそのキーの内容が異なるか」だけを見る。
  -- 変更していない UPDATE は素通しする（既存の正当な更新経路を壊さないための核心）。
  if (new.import_config -> 'notion_mappings') is distinct from (old.import_config -> 'notion_mappings')
     or (new.import_config -> 'kintone_mappings') is distinct from (old.import_config -> 'kintone_mappings') then
    raise exception
      'import_config.notion_mappings / kintone_mappings はサーバの検証済み経路（マッピング保存API）からのみ変更できます';
  end if;

  -- 資格情報側は別メッセージにする（どちらのキーが原因かを、秘密を漏らさずに切り分けられるように）。
  if (new.import_config -> 'kintone_app_tokens') is distinct from (old.import_config -> 'kintone_app_tokens')
     or (new.import_config -> 'kintone_app_ids') is distinct from (old.import_config -> 'kintone_app_ids') then
    raise exception
      'import_config.kintone_app_tokens / kintone_app_ids はサーバの専用経路（接続作成API・アプリ追加/削除API）からのみ変更できます';
  end if;

  return new;
end;
$$;

-- 関数名は 20260722233606 のまま（改名しない理由はヘッダ参照）。実態が名前より広いことを
-- comment で明示する。
comment on function public.integration_connections_guard_mappings() is
  'import_config の notion_mappings / kintone_mappings（マッピング）に加え、kintone_app_tokens / kintone_app_ids（kintone のアプリ資格情報・取り込み対象アプリの正本）の変更を service_role 以外から拒否する BEFORE INSERT/UPDATE ガード。RLS(誰が書けるか)では塞げない「サーバの検証済み経路の迂回」を DB境界(何を書けるか)で塞ぐ。関数名は歴史的経緯で mappings のままだが、守備範囲は資格情報も含む。既存データは書き換えない。';

-- ⚠ トリガー integration_connections_guard_mappings は作り直さない。
-- create or replace は関数の OID を保持するため、既存トリガーがそのまま新しい本体を実行する。
-- 張り替えると「ガードが外れる一瞬」を無意味に作ることになる（ヘッダ参照）。
