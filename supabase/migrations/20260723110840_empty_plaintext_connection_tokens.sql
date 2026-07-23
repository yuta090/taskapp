-- =============================================================================
-- integration_connections: 平文トークン列の空化【contract フェーズ M2】
--
-- 【背景】
-- access_token / refresh_token は 20260214 以来 **平文** で保存され、org owner が RLS 直接
-- SELECT で読めた。M1(20260723110839_backfill_verify_connection_tokens.sql)で暗号化列を
-- 全行で正本化・検証済み。コード(buildTokenColumns / refreshIfNeededCore / decryptConnectionRow)
-- は平文列に実値を書かず・読まなくなった。ここで既存行に残っている平文の実値を消す。
--
--   update ... set access_token = ''   -- NOT NULL 制約を維持するため空文字にする(列は残す)
--   update ... set refresh_token = null
--
-- 【⚠ 適用タイミング — 重要】
-- **M1 適用済み + コードデプロイが完全に浸透した後** に適用する(翌日推奨)。
-- 理由: 平文列にまだ書き込む「旧サーバレスインスタンス」が1つでも残っていると、その
-- インスタンスの refresh 処理が平文を書き戻し、消したそばから平文が復活する競合が起きる。
-- 全インスタンスが新コード(平文を書かない)に入れ替わってから消すこと。
--
-- 【⚠⚠ 必須 PRECONDITION — defer 強化のデプロイ確認（Fable 裁定 2026-07-23）】
-- **この M2 を適用する前に、outbox の「defer」強化（別PR）が本番にデプロイ済みであることを
--   必ず確認する。** M2 で平文列を空化すると、「主DBは健全だが復号RPC/vault だけが一時的に
--   落ちる」障害モードで、復号失敗が temporary_fail として attempt 予算を消費し、8.6時間の
--   持続で個別配達が dead(永久喪失)になり得る。今日の本番は平文フォールバックがこの1スライスを
--   マスクしているが、M2 でそれが構造的に消える。defer 強化(復号/接続fetchの一時障害は
--   attempt を消費せず defer する)がこの穴を塞ぐ。順序は「本コード＋M1 → defer PR → M2 → M3」。
-- 機械検証(M2 適用直前に実行し、defer 分岐が入っていることを確認してから流す):
--   select (prosrc like '%defer%') as defer_deployed
--     from pg_proc where proname = 'rpc_complete_sink_delivery';
--   -- defer_deployed が t でなければ M2 を適用しない(先に defer PR をデプロイする)。
--
-- 【可逆性】
-- 平文の実値は失われるが、トークンの正本は暗号化列(access_token_encrypted /
-- refresh_token_encrypted)に残る。万一平文へ戻す必要が出ても、現行鍵(SYSTEM_ENCRYPTION_KEY)
-- で decrypt_system_secret(暗号化列, 鍵) を書き戻せば復元できる。よって不可逆ではない。
-- NOT NULL 制約・列そのものは触らない(将来の列DROPはさらに後続で判断)。
--
-- 【冪等性】where で「非空/非null」だけを対象にするので再適用しても無害。
-- =============================================================================

-- access_token は NOT NULL。空文字で満たしつつ平文の実値を消す。
update public.integration_connections
   set access_token = ''
 where access_token <> '';

-- refresh_token は nullable。平文の実値を消す。
update public.integration_connections
   set refresh_token = null
 where refresh_token is not null;
