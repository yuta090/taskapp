/**
 * コネクタ・システムユーザー。
 *
 * 外部ツール(gtasks/multica)起点で TaskApp に取り込むタスクの created_by 名義。
 * tasks.created_by は NOT NULL・auth.users(id) FK で、取り込みワーカー/受信 webhook は
 * service_role 実行(auth.uid()=null)かつ対応する対話ユーザーが存在しないため、名義を補完する必要がある。
 * 以前は「接続 org の owner」を名義に採っていたが、owner はテナントの実ユーザーであり
 * 「その人が作った」わけではない外部タスクを owner 名義にするのは誤りだったため、専用の
 * グローバル・システムユーザーに一本化した(Fable 決定 2026-07-20 案A改)。
 *
 * このユーザーは migration `*_connector_system_user.sql` が auth.users に seed する:
 *   - banned_until を遠未来に設定し、GoTrue の全ログイン経路(password/OTP/recovery)を拒否
 *   - encrypted_password NULL・email 未確認・org_memberships 行なしで多層防御
 *   - profiles に display_name='外部連携（システム）' を持ち、UI にはこの表示名が出る
 *
 * ⚠ この UUID は migration 側の seed 値と**完全一致**していること(二重定義。片方だけ変えない)。
 *    seed: supabase/migrations/*_connector_system_user.sql
 */
export const CONNECTOR_SYSTEM_USER_ID = '00000000-0000-4000-a000-000000000001'
