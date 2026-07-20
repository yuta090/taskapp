import { randomUUID } from 'node:crypto'
import { safeFetch } from '@/lib/sinks/ssrf'
import { buildSignatureHeader } from '@/lib/sinks/signature'
import { decryptConnectorSecret } from '@/lib/connectors/secrets'

/**
 * multica API クライアント(送信側)。契約: docs/spec/MULTICA_CONNECTOR_CONTRACT.md §3(送信) / §5(署名)。
 *
 * 宛先(base_url)・署名鍵(send_secret)は接続の metadata に格納する想定:
 *   integration_connections.metadata = {
 *     multica: { base_url: 'https://...', send_secret_encrypted: '...' }
 *   }
 * (multica は provider='multica' の接続の metadata に相乗り。google_tasks の tasklist_id と同じ置き場所の流儀)。
 * send_secret は sink(src/lib/sinks/store.ts)と同方式で暗号化保存され(src/lib/connectors/secrets.ts の
 * encryptConnectorSecret で作成)、読み手はここで decryptConnectorSecret により都度復号する。
 * 平文フォールバックは持たない(本ブランチ未マージ=既存データ無し。クリーンカット)。
 *
 * SSRF検証は safeFetch(src/lib/sinks/ssrf.ts) が内部で必ず通す(https/443/リダイレクト非追従/DNSピン留め)。
 * base_url/send_secret_encrypted が未設定、または復号に失敗した接続は「設定待ち/破損」であり
 * 無限リトライさせない = permanent_fail 相当として status=422 を持つ Error を投げる
 * (dispatch側の classifyError が 422 を permanent_fail に分類する)。
 */

export interface MulticaConnection {
  id: string
  metadata: Record<string, unknown> | null
}

interface MulticaMetadata {
  baseUrl: string
  sendSecret: string
}

export interface MulticaTaskInput {
  taskRef: string
  title: string
  body: string | null
  status: 'todo' | 'in_progress'
  dueDate: string | null
  assigneeHint: string | null
  origin: 'internal' | 'external'
}

export interface MulticaUpsertResult {
  issueId: string
}

/** status/http エラーを Error に status を載せて表現する(google-tasks/client.ts の tasksFetch と同じ流儀)。 */
function httpError(message: string, status?: number): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number }
  if (status !== undefined) err.status = status
  return err
}

async function requireMulticaMetadata(conn: MulticaConnection): Promise<MulticaMetadata> {
  const raw = (conn.metadata?.multica as Record<string, unknown> | undefined) ?? undefined
  const baseUrl = typeof raw?.base_url === 'string' ? raw.base_url : undefined
  const sendSecretEncrypted =
    typeof raw?.send_secret_encrypted === 'string' ? raw.send_secret_encrypted : undefined
  if (!baseUrl || !sendSecretEncrypted) {
    // 422 = permanent_fail(classifyError)。設定待ちのジョブを無限リトライさせない。
    throw httpError(
      `multica connection ${conn.id} is missing metadata.multica.base_url/send_secret_encrypted`,
      422,
    )
  }
  const sendSecret = await decryptConnectorSecret(sendSecretEncrypted)
  if (!sendSecret) {
    // 復号不能(鍵の不一致・データ破損等)も設定待ちと同様に恒久失敗として扱う。
    throw httpError(`multica connection ${conn.id} send_secret could not be decrypted`, 422)
  }
  return { baseUrl, sendSecret }
}

/**
 * ローカル日時をタイムゾーンオフセット付きISO風文字列へ(toISOString禁止・UTC Zにしない)。
 * 契約 §3 の occurred_at 形式(例: "2026-07-20T10:00:00+09:00")に合わせる。
 */
export function formatLocalTimestampWithOffset(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  // getTimezoneOffset()は「UTCより何分遅れているか」を返す(正=UTCより遅れ=西側)。符号を反転してオフセットにする。
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const offsetHours = pad(Math.floor(abs / 60))
  const offsetMins = pad(abs % 60)
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`
}

/** 署名付きPOSTを送り、2xxならJSONをパースして返す。非2xx/ネットワーク失敗はstatus付きErrorをthrowする。 */
async function multicaRequest(meta: MulticaMetadata, path: string, body: string): Promise<unknown> {
  const signature = buildSignatureHeader(meta.sendSecret, body)
  const result = await safeFetch(`${meta.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AgentPM-Signature': signature,
    },
    body,
  })

  if (!result.ok) {
    // ssrf_blocked(DNS rebinding含む)は攻撃対象への無限リトライを避けるため恒久失敗にする。
    const isSsrfBlocked = result.error?.startsWith('ssrf_blocked:') ?? false
    throw httpError(`multica ${path} failed: ${result.error ?? 'unknown error'}`, isSsrfBlocked ? 422 : undefined)
  }

  if (result.status === undefined || result.status < 200 || result.status >= 300) {
    throw httpError(`multica ${path} failed (${result.status})`, result.status)
  }

  if (!result.bodyText) return {}
  try {
    return JSON.parse(result.bodyText)
  } catch {
    // 2xxなのに壊れたJSON。multica側の一時的な不調とみなし一時失敗として再試行させる(statusなし)。
    throw httpError(`multica ${path} returned invalid JSON`)
  }
}

/**
 * issue.upsert(契約 §3.1): タスクを multica に Issue として作成/更新する。
 * multica は同一 task_ref の再送を冪等に扱う(既存Issueを更新)。
 */
export async function sendIssueUpsert(
  conn: MulticaConnection,
  task: MulticaTaskInput,
): Promise<MulticaUpsertResult> {
  const meta = await requireMulticaMetadata(conn)
  const payload = {
    event_id: randomUUID(),
    event_type: 'issue.upsert',
    occurred_at: formatLocalTimestampWithOffset(new Date()),
    connection_id: conn.id,
    task: {
      task_ref: task.taskRef,
      title: task.title,
      body: task.body,
      status: task.status,
      due_date: task.dueDate,
      assignee_hint: task.assigneeHint,
      origin: task.origin,
    },
  }
  const json = (await multicaRequest(meta, '/api/agentpm/issues', JSON.stringify(payload))) as {
    issue_id?: unknown
  }
  if (!json || typeof json.issue_id !== 'string' || !json.issue_id) {
    // 2xxだがレスポンス契約を満たさない。恒久的に壊れている可能性が高いが、multica側の
    // 一時的な応答不備の可能性も残るため一時失敗(statusなし)として再試行に回す。
    throw httpError(`multica issue.upsert response missing issue_id`)
  }
  return { issueId: json.issue_id }
}

/**
 * issue.cancel(契約 §3.2): タスクが対象外化された。multica は Issue をクローズ(AI依頼を止める)。
 */
export async function sendIssueCancel(conn: MulticaConnection, taskRef: string): Promise<void> {
  const meta = await requireMulticaMetadata(conn)
  const payload = {
    event_id: randomUUID(),
    event_type: 'issue.cancel',
    connection_id: conn.id,
    task: { task_ref: taskRef },
  }
  await multicaRequest(meta, '/api/agentpm/issues', JSON.stringify(payload))
}
