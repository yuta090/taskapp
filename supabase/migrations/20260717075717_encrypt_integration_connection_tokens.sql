-- =============================================================================
-- integration_connections: OAuthトークンの暗号化【expand フェーズ / 平文列は残す】
--
-- 【背景】
-- access_token / refresh_token は 20260214_000_integration_connections.sql 以来 **平文** の
-- text 列だった。同リポジトリの他の資格情報は全て pgcrypto で暗号化しており、ここだけ
-- 方針が不揃いだった:
--   - channel_accounts.credentials_encrypted
--   - system_integration_configs.credentials_encrypted
--   - integration_sinks.secret_encrypted
-- 現状の接続は calendar.freebusy(空き時間の参照のみ) と spreadsheets(org owner だけが接続可)
-- に限られていたが、Google Tasks 連携(auth/tasks = 個人の全ToDoの読み書き)を一般スタッフ
-- 全員に接続させる前提が出てきた。平文のまま権限の重さと接続者数を上げるのは許容できない
-- (DBダンプ1つで全スタッフの Google Tasks を書き換えられる)ため、既存3テーブルと同じ
-- encrypt_system_secret / decrypt_system_secret (pgp_sym_encrypt + base64) に揃える。
--
-- 【適用方法 — 鍵が必要】
-- 鍵はDBに置かない(アプリの SYSTEM_ENCRYPTION_KEY と同じ値をGUCで渡す)。**同一セッション**で
-- GUCを設定してから適用すること:
--
--   psql "$DATABASE_URL" <<EOF
--   set app.system_encryption_key = '<Vercel env の SYSTEM_ENCRYPTION_KEY と同じ値>';
--   \i supabase/migrations/20260717075717_encrypt_integration_connection_tokens.sql
--   EOF
--
-- 鍵が未設定/空なら例外で停止する(中途半端に適用されない)。バックフィル後に
-- 復号ラウンドトリップを検証し、1件でも一致しなければ例外で全体をロールバックする。
--
-- 【ロールアウト順序 — 重要】
-- このマイグレーションを **先に適用し、その後にアプリをデプロイする**。
--   - 適用後・デプロイ前: 現行コードは平文列だけを読み書きする。追加した列は無視されるので無害。
--   - デプロイ後: 新コードは暗号化列を読み(無ければ平文へフォールバック)、両方へ書く。
-- 逆順(デプロイ先行)にすると、新コードが存在しない列へ書こうとして失敗する。
--
-- 【平文列の DROP はここではしない】
-- 現行デプロイが平文列を読んでいる間に消すと本番が壊れる。DROP は後続PR(contract フェーズ)で
-- 「平文列への書き込みを止めたコードをデプロイし終えてから」行う。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) 暗号化列の追加（nullable。この時点では現行コードから見えないだけの死んだ列）
-- -----------------------------------------------------------------------------
alter table public.integration_connections
  add column if not exists access_token_encrypted text,
  add column if not exists refresh_token_encrypted text;

comment on column public.integration_connections.access_token_encrypted is
  'pgcrypto暗号化済みaccess_token。encrypt_system_secret(plaintext, SYSTEM_ENCRYPTION_KEY)で作成。';
comment on column public.integration_connections.refresh_token_encrypted is
  'pgcrypto暗号化済みrefresh_token。encrypt_system_secret(plaintext, SYSTEM_ENCRYPTION_KEY)で作成。null=ローテーション対象外/未取得。';

-- -----------------------------------------------------------------------------
-- 2) 既存行のバックフィル + 復号ラウンドトリップ検証
-- -----------------------------------------------------------------------------
do $$
declare
  v_key      text := current_setting('app.system_encryption_key', true);
  v_rows     int;
  v_bad      int;
begin
  if coalesce(v_key, '') = '' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'app.system_encryption_key が未設定です',
      hint    = 'psql セッションで  set app.system_encryption_key = ''<SYSTEM_ENCRYPTION_KEY と同じ値>'';  を実行してから \i してください';
  end if;

  -- access_token は NOT NULL 制約付き。未暗号化の行だけを対象にする(再実行時の二重暗号化を防ぐ)。
  update public.integration_connections
     set access_token_encrypted = public.encrypt_system_secret(access_token, v_key)
   where access_token_encrypted is null;
  get diagnostics v_rows = row_count;
  raise notice 'access_token を暗号化した行数: %', v_rows;

  update public.integration_connections
     set refresh_token_encrypted = public.encrypt_system_secret(refresh_token, v_key)
   where refresh_token is not null
     and refresh_token_encrypted is null;
  get diagnostics v_rows = row_count;
  raise notice 'refresh_token を暗号化した行数: %', v_rows;

  -- 検証: 復号して元の平文に戻ることを全行で確認する。1件でも壊れていたら全体をロールバックする
  -- (中途半端な暗号化のまま平文をDROPする後続フェーズに進ませない)。
  select count(*) into v_bad
    from public.integration_connections
   where public.decrypt_system_secret(access_token_encrypted, v_key) is distinct from access_token
      or (refresh_token is not null
          and public.decrypt_system_secret(refresh_token_encrypted, v_key) is distinct from refresh_token);

  if v_bad > 0 then
    raise exception '復号ラウンドトリップに失敗した行が % 件あります。鍵が正しいか確認してください', v_bad;
  end if;

  raise notice 'ラウンドトリップ検証OK。次はアプリをデプロイしてください(平文列のDROPは後続PR)。';
end $$;

-- -----------------------------------------------------------------------------
-- 3) 暗号化列のNOT NULL化はしない
--    現行コード(このマイグレーション適用後・デプロイ前)は平文列にだけINSERTするため、
--    その窓で新規接続が作られると access_token_encrypted が null の行ができる。
--    アプリ側は「暗号化列が無ければ平文へフォールバック」して読むので実害はなく、
--    contract フェーズでバックフィルし直してから NOT NULL 化する。
-- -----------------------------------------------------------------------------
