-- =============================================================================
-- import_config.notion_mappings / kintone_mappings をDB境界で保護する
-- =============================================================================
--
-- 不変条件（この migration が守るもの）:
--   **サーバがライブスキーマを再取得して検証したマッピングだけが永続化される。**
--   マッピングは「Notion/kintone のどのプロパティ/フィールドが期日・完了・タイトルか」の対応表で、
--   期日は AI秘書の催促（due reminder）に直結する。検証を経ない値が入ると、取り込みが止まるか
--   誤った期日でタスクが起票され、実害が出る。
--
-- なぜ RLS だけでは足りないのか（責務分離）:
--   RLS は「**誰が**書けるか」しか見ない。20260214_000_integration_connections.sql の
--   "users can update own connections" は owner_type='org' なら role='owner' の org member に
--   UPDATE を許すため、org owner は authenticated クライアント（ブラウザの supabase-js）から
--   integration_connections を直接 UPDATE でき、保存API（ライブスキーマ再取得＋
--   validateMappingAgainstSchema）を**完全に迂回**できる。存在しないフィールド・型不一致・
--   未登録アプリID・任意の confirmed_at を書き込めてしまう。
--   トリガーは「**何を**書けるか」を見る。RLS=誰が / トリガー=何を、と責務を分けて全書込経路
--   （REST/RPC/SQL いずれも）を1構造で塞ぐ。これは
--   20260720181730_connector_import_config_validation.sql（import_config の org 境界検証）と
--   まったく同じ姿勢であり、そのトリガーの「対象キーを増やした版」ではなく、
--   **判定軸が違う（値の妥当性ではなく「変更してよい主体か」）ため別トリガーとして足す**。
--
-- ロール判定（なぜこの2条件のORにしたか。独自の判定を発明しない）:
--   このリポジトリには service_role 素通しの書き方が2系統ある:
--     (a) auth.role() = 'service_role'
--         … 20260721133427_due_reminder_pr0.sql の app_guard_external_due()、
--            20260721215120_org_due_reminders_toggle.sql
--     (b) current_setting('role', true) = 'service_role'
--         … 20260307_001_portal_sections_write_guard.sql,
--            20260308_002_agency_settings_write_guard.sql,
--            20260308_003_task_pricing_write_guard.sql
--   PostgREST 経由では両者は一致する（(a)=JWTのrole claim / (b)=PostgRESTが張る SET LOCAL ROLE）。
--   どちらか一方だけを採ると、もう一方の系統しか成立しない経路（(a)は JWT の無い psql/pg_cron、
--   (b)は SET ROLE を伴わない接続）で **fail-closed 側に倒れて正当な保守作業まで止まる**。
--   両方を OR で見ることで、既存2系統のどちらの流儀の呼び出しも従来どおり通る。
--   ⚠ 攻撃面は広がらない: authenticated ロールは service_role のメンバーではないため
--   `set role service_role` は権限エラーになり、PostgREST は role GUC をクライアントに開放して
--   いない（設定できるのは request.jwt.claims 側だが、そこは署名済みJWTの内容で決まる）。
--   ⚠ 運用（psql からの保守）: JWT の無い psql は auth.role() が NULL になるため、
--   マッピングを直す保守SQLは `set local role service_role;` を先に実行すること（(b)で通る）。
--
-- SECURITY DEFINER は付けない: テーブルを一切読まず auth.role()/current_setting を見るだけのため
--   （app_guard_external_due と同じ理由）。search_path は '' に固定し参照は完全修飾する。
--
-- 既存データへの影響（重要）:
--   このトリガーは**既存データを書き換えない**。既に不正なマッピングを持つ行があっても、
--   その行を UPDATE するとき「マッピングを変更しようとした場合だけ」拒否する。
--   マッピングを変更しない UPDATE（トークンリフレッシュ・status 更新・target_space_id 変更・
--   last_import_success_at 更新など）は素通しするため、既存の正当な更新経路は一切壊れない。
--
-- 適用: トリガー＋関数の追加のみ（列・データ変更なし）。アプリ稼働中に適用可。
-- ロールバック（完全に可逆）:
--   drop trigger if exists integration_connections_guard_mappings on public.integration_connections;
--   drop function if exists public.integration_connections_guard_mappings();
--   不可逆なものは無い（データを書き換えないため）。ただし撤去すると上記の迂回経路が再び開く。
-- =============================================================================

create or replace function public.integration_connections_guard_mappings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- service_role（保存API・汎用PATCH RPC・import worker 等の createAdminClient 経由）は素通し。
  -- 2系統の判定を OR で見る理由は冒頭コメント参照。
  if auth.role() = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- ホットパス: import_config を変更しない UPDATE（トークンリフレッシュ・status 更新等）は
  -- そもそも判定不要。is not distinct from で NULL 同士も等価扱いにする。
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
    return new;
  end if;

  -- UPDATE: 「旧値と新値でそのキーの内容が異なるか」だけを見る。
  -- 変更していない UPDATE は素通しする（既存の正当な更新経路を壊さないための核心）。
  if (new.import_config -> 'notion_mappings') is distinct from (old.import_config -> 'notion_mappings')
     or (new.import_config -> 'kintone_mappings') is distinct from (old.import_config -> 'kintone_mappings') then
    raise exception
      'import_config.notion_mappings / kintone_mappings はサーバの検証済み経路（マッピング保存API）からのみ変更できます';
  end if;

  return new;
end;
$$;

comment on function public.integration_connections_guard_mappings() is
  'import_config.notion_mappings / kintone_mappings の変更を service_role 以外から拒否する BEFORE INSERT/UPDATE ガード。RLS(誰が書けるか)では塞げない「保存APIのライブスキーマ検証の迂回」を、DB境界(何を書けるか)で塞ぐ。既存データは書き換えない。';

drop trigger if exists integration_connections_guard_mappings
  on public.integration_connections;

create trigger integration_connections_guard_mappings
  before insert or update on public.integration_connections
  for each row
  execute function public.integration_connections_guard_mappings();
