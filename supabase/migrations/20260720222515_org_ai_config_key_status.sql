-- =============================================================================
-- org_ai_config: APIキーの妥当性検証結果を保持する（保存時にプロバイダー疎通で判定）
-- 設計正本: src/lib/ai/client.ts（verifyAiKey / getAiConfigStatus）
-- コードレビュー(Codex 2026-07-20) Rec#1 の残課題対応:
--   これまで getAiConfigStatus は enabled/キー有無しか見ず、「enabled=true だが鍵が壊れている」設定を
--   "設定済み(緑)" と表示していた（cron では毎日復号/認証で失敗するのにユーザーに修正導線が出ない）。
--   保存時にプロバイダーへ疎通確認(verifyAiKey)し、その結果をここに残して可視化に反映する。
--
-- key_status:
--   'unverified' = 未検証（旧データ、または保存時に疎通判定できなかった=429/5xx/ネットワーク障害）。
--                  getAiConfigStatus は valid 側に倒す（実際に動いている設定を false negative で赤くしない）。
--   'valid'      = 保存時にプロバイダーが 200 を返した。
--   'invalid'    = 保存時にプロバイダーが 401/403（認証拒否）＝鍵が無効。configured:false / reason:invalid。
-- 既存行は default 'unverified'＝従来どおり "設定済み" 扱いのまま（後方互換・切らない）。
-- =============================================================================

alter table public.org_ai_config
  add column if not exists key_status text not null default 'unverified'
    check (key_status in ('unverified', 'valid', 'invalid')),
  add column if not exists key_verified_at timestamptz;

comment on column public.org_ai_config.key_status is
  '保存時のプロバイダー疎通による鍵の妥当性: unverified(未検証/判定不能・valid扱い) / valid / invalid(認証拒否)';
comment on column public.org_ai_config.key_verified_at is
  'key_status を最後に valid と確認した時刻（unverified/invalid では NULL）';

-- ロールバック:
--   alter table public.org_ai_config drop column if exists key_verified_at;
--   alter table public.org_ai_config drop column if exists key_status;
