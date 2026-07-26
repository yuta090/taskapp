import type { HostPolicy } from '@/lib/task-sync/types'

/**
 * 見積書・請求書アダプタ層 — 会計/請求サービスを1つの型で扱うための境界。
 *
 * ⚠ この層が扱う範囲（厳守）:
 *   **見積書・請求書の作成と、その発行状態の取り込み** だけを行う。仕訳・入出金・経費・決算
 *   といった会計データ全般には一切触れない。UI・LP・営業資料でも「会計ソフトと連携」とだけ
 *   書くと会計データ全般が同期されるように読まれるため、必ず「見積書・請求書の作成」まで
 *   書き切ること（src/lib/integrations/registry.ts の accounting カテゴリのコメントと対）。
 *
 * task-sync（src/lib/task-sync/types.ts）と分けている理由:
 *   タスク同期は「外部が正本で、差分を取り込み続ける」形。こちらは「TaskApp が正本で、人が
 *   押した時に1回だけ外部へ発行する」形で、不変条件がまるで違う。とくに**二重発行が実害**
 *   （同じ請求書が2通、取引先に届く）であり、差分カーソルではなく冪等キーで守る必要がある。
 *   同じアダプタ型に押し込むと、どちらの保証も中途半端になる。
 *
 * 実装の約束:
 *   - **アダプタはDBに触らない**。責務は「外部API ⇄ この中間表現」の変換だけ。発行記録
 *     （billing_documents）への書き込み・冪等の判定は呼び出し側（サービス層）が行う。
 *   - 失敗は providerError() で status を載せて throw する（task-sync と同じ語彙を共有する）。
 *   - 日付は必ずローカル日付 'YYYY-MM-DD'（CLAUDE.md: toISOString() 由来のUTC変換で日本時間が
 *     1日ずれる事故を構造的に防ぐ）。発行日が1日ずれた請求書は実務で事故になる。
 */

/** 見積書・請求書を作れるサービスのID。registry.ts の IntegrationId の部分集合。 */
export type AccountingProviderId = 'freee' | 'money_forward' | 'misoca'

/** 発行する書類の種類。 */
export type DocumentType = 'quote' | 'invoice'

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  quote: '見積書',
  invoice: '請求書',
}

/**
 * 発行先（会計ソフト側の取引先）。TaskApp のスペースと1対1で紐づける。
 *
 * 取引先を**自動作成しない**のは、会計ソフト側の取引先マスタが請求・入金消込の土台であり、
 * 表記ゆれた重複行が増えると経理の実務が壊れるため。既存の取引先から人が1度選ぶ。
 */
export interface AccountingPartner {
  id: string
  name: string
  /** 会計ソフト側の補助表示（コード・敬称など）。一覧で同名を見分けるためだけに使う。 */
  hint?: string | null
}

/** 書類1行分の明細。TaskApp では原則「タスク1件＝明細1行」。 */
export interface DocumentLine {
  /** 品目名。タスクのタイトルが入る。 */
  name: string
  /** 数量。TaskApp は工数を持たない行もあるため既定は 1。 */
  quantity: number
  /** 単価（円・税抜）。 */
  unitPrice: number
  /** 税率(%)。10 / 8 / 0 のいずれか。 */
  taxRate: number
  /** 備考（タスクの説明など）。 */
  description?: string | null
}

/** 発行する書類の中身。provider 非依存の中間表現。 */
export interface DocumentInput {
  /** 会計ソフト側の取引先ID（AccountingPartner.id）。 */
  partnerId: string
  /** 件名。既定はスペース名。 */
  title: string
  /** 発行日（ローカル日付 'YYYY-MM-DD'）。 */
  issueDate: string
  /** 支払期日／見積有効期限（ローカル日付）。無ければ null。 */
  dueDate: string | null
  lines: DocumentLine[]
  /** 備考欄。 */
  memo?: string | null
}

/**
 * 発行済み書類の状態。provider ごとの生ステータス名は千差万別なので、TaskApp 側の語彙に畳む。
 *
 *  - draft:     下書き（まだ相手に出していない）
 *  - issued:    発行・送付済み
 *  - paid:      入金確認済み（請求書のみ）
 *  - accepted:  受注・承認済み（見積書のみ）
 *  - canceled:  取消・削除済み
 *  - unknown:   provider が返した値を畳めなかった（生の値は rawStatus に残す）
 *
 * unknown を用意しているのは、知らないステータスを勝手に issued 等へ寄せると
 * 「入金済みでないのに入金済みとしてタスクを閉じる」事故が起きるため。分からないものは
 * 分からないままにして、呼び出し側が何もしないようにする。
 */
export type DocumentStatus = 'draft' | 'issued' | 'paid' | 'accepted' | 'canceled' | 'unknown'

/** 発行結果。 */
export interface IssuedDocument {
  /** 外部側の一意ID。billing_documents.external_id になる。 */
  externalId: string
  /** 書類番号（請求書番号・見積番号）。取れなければ null。 */
  documentNumber: string | null
  status: DocumentStatus
  /** provider が返した生のステータス文字列（監査・原因調査用）。 */
  rawStatus: string | null
  /** 合計金額（円・税込）。取れなければ null。 */
  totalAmount: number | null
  /** 会計ソフト上でその書類を開くURL。取れなければ null。 */
  webUrl: string | null
}

/** 復号済みの資格情報。取得元（token-manager）はサービス層の関心事。 */
export interface AccountingCredentials {
  /** OAuth のアクセストークン。 */
  token: string
}

/**
 * アダプタに渡す実行文脈。
 *
 * config には接続ごとの可視設定が入る。会計サービスは「どの事業所か」を必ず要求する
 * （freee=company_id / マネーフォワード=office / Misoca=アカウント）ため、その保持先。
 * ⚠ キー名は provider 名を接頭辞に付ける（`freee_company_id`）。同じ袋を全 provider が使う。
 */
export interface AccountingContext {
  credentials: AccountingCredentials
  config?: Record<string, unknown>
}

/**
 * 見積書・請求書アダプタ。1サービス1実装。
 */
export interface AccountingAdapter {
  readonly id: AccountingProviderId
  readonly label: string
  /** 接続先ホストの信頼境界。会計サービスは全て固定ホスト。 */
  readonly hostPolicy: HostPolicy
  /** この provider で作れる書類。両方作れるとは限らない。 */
  readonly supports: readonly DocumentType[]

  /**
   * 発行先に選べる取引先を列挙する。
   * @param query 入力補助の絞り込み文字列（provider が対応していれば使う）
   */
  listPartners(ctx: AccountingContext, opts?: { query?: string }): Promise<AccountingPartner[]>

  /**
   * 書類を作る。
   *
   * @param idempotencyKey 同じ内容の再送で二重発行しないための鍵。provider が冪等ヘッダに
   *   対応していれば渡す。対応していない provider でも、呼び出し側が発行記録の一意制約で
   *   守れるよう、この値は必ず記録される（アダプタ側の対応可否に依存させない）。
   */
  createDocument(
    ctx: AccountingContext,
    type: DocumentType,
    input: DocumentInput,
    idempotencyKey: string,
  ): Promise<IssuedDocument>

  /** 発行済み書類の現在の状態を取り直す（入金済みかどうかの確認に使う）。 */
  getDocument(ctx: AccountingContext, type: DocumentType, externalId: string): Promise<IssuedDocument>
}
