-- =============================================================================
-- LINE友だち追加QR: channel_accounts.line_basic_id（公開情報のキャッシュ列）
-- 設計正本: docs/spec/CHANNEL_PLUMBING_SPEC.md（友だち追加導線と本人特定の分離）
--
-- 目的: 「Botを見つけて友だち追加する手間」を消すQR/URL導線の元になる basic_id
--   (@xxxx。LINEの公開情報で秘匿性は無い) をキャッシュする。identity(本人特定)は
--   従来どおりコード返信方式のみが正であり、この列はそれを一切変更しない
--   （友だち追加しただけでは何とも紐付かない。QRは「見つける」までの純粋加算UX）。
--
-- credentials_encrypted 同様 channel_accounts は資格情報テーブルであり RLS は
-- service_role 専用のまま（本migrationはRLS/GRANTを一切変更しない）。line_basic_id は
-- 公開情報だが、この列単体を authenticated に開放する変更は別PRで明示的に行う
-- （basic_id はUI提供APIが読み取り、service roleで判定して渡す設計 — 直接クエリはさせない）。
--
-- 加算のみ（既存行は NULL のまま）。取得済み basic_id が無いアカウントは
-- getLineBasicIdForOrg が /v2/bot/info から遅延バックフィルする（ベストエフォート）。
-- =============================================================================

alter table public.channel_accounts
  add column if not exists line_basic_id text;

comment on column public.channel_accounts.line_basic_id is
  'LINE公式アカウントのbasic ID (@xxxx)。友だち追加QR/URLの導出に使う公開情報。/v2/bot/info から遅延バックフィル。identity(本人特定)には一切使わない — 本人特定は従来どおりコード返信方式のみが正。';

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) 既存行は line_basic_id が NULL のままであること:
--        select count(*) from channel_accounts where line_basic_id is not null; -- 適用直後は 0
--   2) RLS は既存のまま変更されていないこと（authenticated は channel_accounts に一切アクセス不可）。
-- ロールバック（加算のみ・巻き戻し可）:
--   alter table public.channel_accounts drop column line_basic_id;
-- =============================================================================
