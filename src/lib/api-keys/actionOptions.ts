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

/**
 * 画面から届いた「許可する操作」を DB に入れられる形にそろえる。
 * 未指定は読み取りだけ・読み取りは必ず含める・並びはこの一覧の順。
 * 知らない値や配列以外は null（呼び出し側で 400 にし、DB の CHECK 制約のエラー文を返さない）。
 */
export function normalizeAllowedActions(input: unknown): ApiKeyActionOption['value'][] | null {
  if (input === undefined || input === null) return ['read']
  if (!Array.isArray(input)) return null
  const known = new Set<string>(API_KEY_ACTION_VALUES)
  if (!input.every((v) => typeof v === 'string' && known.has(v))) return null
  const chosen = new Set<string>(['read', ...input])
  return API_KEY_ACTION_VALUES.filter((v) => chosen.has(v))
}

/** 一覧に出す「許可した操作」。画面の名前で画面の順に並べ、知らない値はそのまま出す */
export function formatApiKeyActions(actions: readonly string[]): string {
  const known = API_KEY_ACTION_OPTIONS.filter((o) => actions.includes(o.value)).map((o) => o.label)
  const unknown = actions.filter((a) => !API_KEY_ACTION_OPTIONS.some((o) => o.value === a))
  return [...known, ...unknown].join('・')
}
