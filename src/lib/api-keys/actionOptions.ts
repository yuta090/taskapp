/**
 * APIキーの「許可する操作」の選択肢（設定画面 /settings/api-keys が描く）。
 *
 * 値は DB の CHECK 制約（api_keys.allowed_actions <@ ARRAY['read','write','delete','bulk']）と
 * agentpm-core の ActionType（read / write / delete / bulk）に一致させる。
 * bulk は一括系ツール（task_import＝CSV取り込み、client_invite_bulk_create＝一括招待）に要る区分で、
 * 画面に無いと「一括操作できるキーを画面から作れない」状態になる（実際にそうなっていた）。
 */
export interface ApiKeyActionOption {
  value: 'read' | 'write' | 'delete' | 'bulk'
  label: string
  description: string
  /** 外せない操作（read は全キーに必須） */
  required?: boolean
}

export const API_KEY_ACTION_OPTIONS: readonly ApiKeyActionOption[] = [
  { value: 'read', label: '読み取り', description: 'タスク一覧取得など', required: true },
  { value: 'write', label: '書き込み', description: 'タスク作成・更新' },
  { value: 'delete', label: '削除', description: 'タスク削除' },
  { value: 'bulk', label: '一括操作', description: 'CSVからのタスク一括取り込み・クライアントの一括招待' },
] as const

export const API_KEY_ACTION_VALUES = API_KEY_ACTION_OPTIONS.map((o) => o.value)
