-- =============================================================================
-- integration_connections: 暗号化列のバックフィル + 全行ラウンドトリップ検証
--   【contract フェーズ M1 / 平文列はまだ消さない】
--
-- 【背景】
-- 20260717075717_encrypt_integration_connection_tokens.sql が expand フェーズとして
-- access_token_encrypted / refresh_token_encrypted 列を足し、既存行をバックフィルした。
-- ただし expand の検証は「今回暗号化した行だけ」に限定していた(適用窓で現行コードが平文だけ
-- INSERT し得るため)。その後 access_token を空文字にし列SELECTを絞る contract フェーズへ進む前に、
-- **全行**で暗号化列が正本として揃っている(平文と一致して復号できる)ことをここで固める。
--
-- このマイグレーションがやること:
--   1) access_token_encrypted が未設定で平文 access_token が非空の行を暗号化してバックフィル。
--   2) refresh_token があって refresh_token_encrypted が未設定の行を暗号化してバックフィル。
--   3) **全行**で暗号化列を復号し、元の平文と一致するか検証。1件でも不一致なら例外で全ロールバック。
-- 平文列は **消さない**(消すのは後続の M2 = empty_plaintext_connection_tokens.sql)。
--
-- 【冪等性】再適用しても無害。バックフィルは「暗号化列が null の行」だけを対象にするので
-- 二重暗号化しない。検証は毎回全行を確認する(既に暗号化済みでも一致するはず)。
--
-- 【適用方法 — 鍵が必要】
-- 鍵はDBに置かない(アプリの SYSTEM_ENCRYPTION_KEY と同じ値をGUCで渡す)。**同一セッション**で
-- GUCを設定してから適用すること:
--
--   psql "$DATABASE_URL" <<EOF
--   set app.system_encryption_key = '<Vercel env の SYSTEM_ENCRYPTION_KEY と同じ値>';
--   \i supabase/migrations/20260723110839_backfill_verify_connection_tokens.sql
--   EOF
--
-- 鍵が未設定/空なら例外で停止する(中途半端に適用されない)。
--
-- 【ロールアウト順序 — 重要】
--   M1(このファイル): 暗号化列を全行で正本化 + 検証。平文は残す。→ この後にコードをデプロイ。
--   コードデプロイ: 新コード(buildTokenColumns/refreshIfNeededCore)は平文列に実値を書かず、
--                   読みは暗号化列のみ。旧サーバレスインスタンスが残る間は平文も併存できる。
--   M2: 平文列を空化(コードデプロイが完全に浸透した後・翌日推奨)。
--   M3: 秘密列の列レベルSELECTを revoke。
-- =============================================================================

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

  -- 1) access_token のバックフィル。暗号化列が未設定で、平文が非空の行だけを対象にする
  --    (再適用時の二重暗号化を防ぐ / 平文が空''の行は暗号化しても意味が無いので触らない)。
  update public.integration_connections
     set access_token_encrypted = public.encrypt_system_secret(access_token, v_key)
   where access_token_encrypted is null
     and access_token <> '';
  get diagnostics v_rows = row_count;
  raise notice 'access_token を暗号化した行数: %', v_rows;

  -- 2) refresh_token のバックフィル。access_token と同じく「非空」を対象条件に揃える
  --    (refresh_token <> '' は SQL 上 null も除外する = 「refresh を持つ行だけ」)。
  update public.integration_connections
     set refresh_token_encrypted = public.encrypt_system_secret(refresh_token, v_key)
   where refresh_token <> ''
     and refresh_token_encrypted is null;
  get diagnostics v_rows = row_count;
  raise notice 'refresh_token を暗号化した行数: %', v_rows;

  -- 3) 全行ラウンドトリップ検証。
  --    contract フェーズはこの後 access_token を空化するので、ここで「全行」暗号化列が正本として
  --    揃っていることを保証しないと、平文を消した瞬間にトークンを失う行が出る。
  --    - access_token が非空の行: 復号結果が access_token と一致すること。
  --    - refresh_token が非null の行: 復号結果が refresh_token と一致すること。
  --    1件でも不一致(鍵不整合・バックフィル漏れ)なら例外を投げて全体をロールバックする。
  --    平文を消す前に鍵/データの調査を先に行うべき、という意味で止める。
  select count(*) into v_bad
    from public.integration_connections
   where (access_token <> ''
          and public.decrypt_system_secret(access_token_encrypted, v_key) is distinct from access_token)
      or (refresh_token <> ''
          and public.decrypt_system_secret(refresh_token_encrypted, v_key) is distinct from refresh_token);

  if v_bad > 0 then
    raise exception
      '全行ラウンドトリップ検証に失敗した行が % 件あります。鍵(app.system_encryption_key)が正しいか、バックフィル漏れが無いかを調査してください。平文列の空化(M2)へは進まないでください', v_bad;
  end if;

  raise notice '全行ラウンドトリップ検証OK。暗号化列が正本として揃っています。次はコードをデプロイし、浸透後に M2(平文列の空化)を適用してください。';
end $$;
