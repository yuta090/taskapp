import { accountingFetch } from '@/lib/accounting/http'
import { providerError } from '@/lib/task-sync/types'
import type { HostPolicy } from '@/lib/task-sync/types'
import type {
  AccountingAdapter,
  AccountingContext,
  AccountingPartner,
  DocumentInput,
  DocumentStatus,
  DocumentType,
  IssuedDocument,
} from '@/lib/accounting/types'

/**
 * freee請求書 アダプタ（見積書・請求書の作成のみ。会計帳簿・仕訳は扱わない）。
 *
 * 実機で確認した事実（2026-07-26、認証なしリクエストの応答コードで経路の実在を確認）:
 *   - `https://api.freee.co.jp/iv/invoices`   → 401 `{"code":"invalid_access_token"}`（実在）
 *   - `https://api.freee.co.jp/iv/quotations` → 401（実在）
 *   - `https://api.freee.co.jp/iv/delivery_slips` → 401（実在・納品書。本アダプタでは使わない）
 *   - `https://api.freee.co.jp/iv/partners`   → 404（**存在しない**）
 *   - `https://api.freee.co.jp/api/1/partners` → 400（実在。会計APIの取引先。company_id 必須）
 *   - `https://api.freee.co.jp/api/1/companies` → 401（実在。事業所一覧）
 *   よって取引先の一覧は freee請求書側ではなく**会計APIの取引先マスタ**から引く。freee は
 *   事業所（company）配下で取引先を共有しているため、これが正しい引き先になる。
 *
 * OAuth:
 *   - 認可 `https://accounts.secure.freee.co.jp/public_api/authorize`（302を確認）
 *   - トークン `https://accounts.secure.freee.co.jp/public_api/token`（POST専用のためGETでは404）
 *   - アクセストークンの寿命は24時間。refresh は token-manager（src/lib/integrations/token-manager.ts）
 *     の共通経路に載せる。
 *
 * ⚠ 未検証（実アカウントでの疎通時に必ず確認すること）:
 *   リクエストボディの**フィールド名と必須項目**は公開リファレンスがJS描画のため取得できず、
 *   freee Developers の告知（partner_title / partner_sending_method の記述）と一般的な
 *   freee API の形から組んでいる。ズレた場合に直す範囲を最小にするため、変換は下の
 *   buildDocumentPayload() に閉じ込めてある（アダプタの他の部分は触らずに済む）。
 */

const API_BASE = 'https://api.freee.co.jp'

const FREEE_HOST_POLICY = { kind: 'fixed', host: 'api.freee.co.jp' } as const satisfies HostPolicy

const REQUEST_TIMEOUT_MS = 20_000

/** 取引先一覧の1ページ最大件数（会計API の上限）。 */
const PARTNER_PAGE_LIMIT = 100

/** 取引先一覧のページ数上限（安全弁。異常応答での無限ループを防ぐ）。 */
const MAX_PARTNER_PAGES = 20

/** 書類種別 → freee請求書のパス。 */
const DOCUMENT_PATH: Record<DocumentType, string> = {
  quote: '/iv/quotations',
  invoice: '/iv/invoices',
}

interface FreeePartner {
  id: number
  name?: string
  code?: string | null
  shortcut1?: string | null
}

interface FreeeDocument {
  id?: number
  quotation_number?: string | null
  invoice_number?: string | null
  total_amount?: number | string | null
  quotation_status?: string | null
  invoice_status?: string | null
  web_url?: string | null
}

/** 接続ごとの必須設定（どの事業所に発行するか）。 */
function requireCompanyId(ctx: AccountingContext): number {
  const raw = ctx.config?.freee_company_id
  const companyId = typeof raw === 'string' ? Number(raw) : raw
  if (typeof companyId !== 'number' || !Number.isInteger(companyId) || companyId <= 0) {
    // 設定漏れは再試行しても直らない。接続設定画面へ戻す必要がある。
    throw providerError('freee: 事業所（company_id）が設定されていません', {
      permanent: true,
      status: 400,
    })
  }
  return companyId
}

/**
 * freee のステータス文字列を TaskApp の語彙に畳む。
 *
 * 知らない値を issued/paid へ寄せない（＝unknown に落とす）のが要点。入金前の請求書を
 * 「入金済み」と誤認すると、督促が止まって取りはぐれる。
 */
export function mapFreeeStatus(type: DocumentType, raw: string | null | undefined): DocumentStatus {
  if (!raw) return 'unknown'
  const value = raw.toLowerCase()
  if (value === 'draft' || value === 'unsaved') return 'draft'
  if (value === 'deleted' || value === 'canceled' || value === 'cancelled') return 'canceled'
  if (type === 'quote') {
    if (value === 'submitted' || value === 'issue' || value === 'issued' || value === 'sent') return 'issued'
    if (value === 'agreed' || value === 'accepted' || value === 'ordered') return 'accepted'
    return 'unknown'
  }
  if (value === 'issue' || value === 'issued' || value === 'sent' || value === 'submitted') return 'issued'
  if (value === 'paid' || value === 'settled') return 'paid'
  return 'unknown'
}

/**
 * 中間表現 → freee のリクエストボディ。
 *
 * ここだけが freee 固有のフィールド名を知っている。仕様のズレはこの関数の修正で吸収する。
 */
export function buildDocumentPayload(
  companyId: number,
  type: DocumentType,
  input: DocumentInput,
): Record<string, unknown> {
  const lines = input.lines.map((line) => ({
    type: 'item',
    description: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    tax_rate: line.taxRate,
    // 明細の備考。品目名と別枠で持てるツールが多いが、freee は description が品目名扱いのため
    // 補足はここに寄せず、書類全体の備考（memo）へ送る（明細が読みにくくなるのを避ける）。
  }))

  const payload: Record<string, unknown> = {
    company_id: companyId,
    partner_id: Number(input.partnerId),
    title: input.title,
    lines,
  }

  if (type === 'quote') {
    payload.quotation_date = input.issueDate
    // 見積の「期限」は有効期限。支払期日ではないので別キーに入れる。
    if (input.dueDate) payload.expiration_date = input.dueDate
  } else {
    payload.issue_date = input.issueDate
    if (input.dueDate) payload.due_date = input.dueDate
  }

  if (input.memo) payload.description = input.memo

  return payload
}

function normalizeDocument(type: DocumentType, raw: FreeeDocument): IssuedDocument {
  const rawStatus = (type === 'quote' ? raw.quotation_status : raw.invoice_status) ?? null
  const total = raw.total_amount == null ? null : Number(raw.total_amount)
  return {
    externalId: raw.id != null ? String(raw.id) : '',
    documentNumber: (type === 'quote' ? raw.quotation_number : raw.invoice_number) ?? null,
    status: mapFreeeStatus(type, rawStatus),
    rawStatus,
    totalAmount: Number.isFinite(total as number) ? (total as number) : null,
    webUrl: raw.web_url ?? null,
  }
}

/** freee の応答から書類本体を取り出す（`{"invoice": {...}}` のような包みを剥がす）。 */
function unwrapDocument(type: DocumentType, body: unknown): FreeeDocument {
  if (!body || typeof body !== 'object') return {}
  const obj = body as Record<string, unknown>
  const key = type === 'quote' ? 'quotation' : 'invoice'
  const inner = obj[key]
  if (inner && typeof inner === 'object') return inner as FreeeDocument
  return obj as FreeeDocument
}

function freeeFetch(
  ctx: AccountingContext,
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): Promise<unknown> {
  return accountingFetch(FREEE_HOST_POLICY, 'freee', ctx.credentials.token, `${API_BASE}${path}`, {
    ...init,
    // freee はAPIバージョンをヘッダで固定できる。付けないと将来の既定変更で挙動が変わる。
    headers: { 'X-Api-Version': '2020-06-15' },
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
}

export const freeeAdapter: AccountingAdapter = {
  id: 'freee',
  label: 'freee請求書',
  hostPolicy: FREEE_HOST_POLICY,
  supports: ['quote', 'invoice'],

  async listPartners(ctx, opts): Promise<AccountingPartner[]> {
    const companyId = requireCompanyId(ctx)
    const partners: AccountingPartner[] = []

    // 会計APIの取引先マスタを引く（freee請求書側に取引先エンドポイントは無い＝404で確認済み）。
    for (let page = 0; page < MAX_PARTNER_PAGES; page++) {
      const params = new URLSearchParams({
        company_id: String(companyId),
        limit: String(PARTNER_PAGE_LIMIT),
        offset: String(page * PARTNER_PAGE_LIMIT),
      })
      if (opts?.query) params.set('keyword', opts.query)

      const body = (await freeeFetch(ctx, `/api/1/partners?${params.toString()}`, {
        method: 'GET',
      })) as { partners?: FreeePartner[] }

      const chunk = body.partners ?? []
      for (const partner of chunk) {
        partners.push({
          id: String(partner.id),
          name: partner.name ?? '(名称未設定)',
          hint: partner.code ?? partner.shortcut1 ?? null,
        })
      }
      // 満たない＝最終ページ。取り切ったので抜ける。
      if (chunk.length < PARTNER_PAGE_LIMIT) break
    }

    return partners
  },

  async createDocument(ctx, type, input, idempotencyKey): Promise<IssuedDocument> {
    const companyId = requireCompanyId(ctx)
    const payload = buildDocumentPayload(companyId, type, input)
    const body = await freeeFetch(ctx, DOCUMENT_PATH[type], {
      method: 'POST',
      body: payload,
      idempotencyKey,
    })
    return normalizeDocument(type, unwrapDocument(type, body))
  },

  async getDocument(ctx, type, externalId): Promise<IssuedDocument> {
    const companyId = requireCompanyId(ctx)
    const params = new URLSearchParams({ company_id: String(companyId) })
    const body = await freeeFetch(ctx, `${DOCUMENT_PATH[type]}/${encodeURIComponent(externalId)}?${params}`, {
      method: 'GET',
    })
    return normalizeDocument(type, unwrapDocument(type, body))
  },
}
