import { createHash } from 'crypto'

import type { DocumentLine, DocumentType } from '@/lib/accounting/types'

/**
 * 見積書・請求書を「作る」ときの中核ロジック（外部I/OもDBも持たない純粋な部分）。
 *
 * ここに置く判断は2つだけで、どちらも間違えると金銭事故になる:
 *   1. 何を明細にするか（金額の欠けたタスクを黙って0円で出さない）
 *   2. 二重発行をどう止めるか（冪等キー）
 */

/** タスク1件から明細1行を作るのに要る最小の形。DBの行そのものではなく、呼び出し側が詰める。 */
export interface IssuableTask {
  id: string
  title: string
  /** 顧客に提示する金額（task_pricing.sell_total）。null は「まだ決まっていない」。 */
  sellTotal: number | null
}

/** 消費税率(%)。TaskApp は品目ごとの税率を持たないため、書類単位で1つ選ぶ。 */
export type TaxRate = 10 | 8 | 0

export class MissingAmountError extends Error {
  constructor(readonly taskTitles: string[]) {
    super(`金額が入っていないタスクがあります: ${taskTitles.join('、')}`)
    this.name = 'MissingAmountError'
  }
}

/**
 * 選ばれたタスクから明細行を作る。
 *
 * 金額未入力のタスクが1件でもあれば**失敗させる**。0円として黙って通すと、請求漏れが
 * 「請求済み」の記録だけ残して発覚しなくなる（後から気づいても取引先に再請求しづらい）。
 * 出す前に止めるほうが安い。
 */
export function buildLinesFromTasks(tasks: IssuableTask[], taxRate: TaxRate): DocumentLine[] {
  if (tasks.length === 0) {
    throw new Error('書類に含めるタスクが選ばれていません')
  }

  const missing = tasks.filter((t) => t.sellTotal == null || !Number.isFinite(t.sellTotal))
  if (missing.length > 0) {
    throw new MissingAmountError(missing.map((t) => t.title))
  }

  return tasks.map((task) => ({
    name: task.title,
    // TaskApp の金額はタスク単位の総額。工数×単価に割り戻すと端数が出るため数量は常に1にする。
    quantity: 1,
    unitPrice: task.sellTotal as number,
    taxRate,
  }))
}

/** 冪等キーの材料。ここに含めた要素が変われば「別の書類」として発行できる。 */
export interface IdempotencyParts {
  spaceId: string
  docType: DocumentType
  partnerId: string
  issueDate: string
  taskIds: string[]
  /** 税抜合計。金額だけ直して出し直す場合に別の書類として扱えるようにする。 */
  subtotal: number
}

/**
 * 二重発行を止める鍵を作る。
 *
 * 同じ内容・同じ発行日なら必ず同じ値になる ＝ 二度押し・再送・ブラウザ復元で2通目が
 * 作られない（DB側の一意制約で物理的に弾かれる）。逆に、金額を直した・対象を変えた・
 * 日を改めた場合は別の値になるので、正当な再発行は妨げない。
 *
 * タスクIDを並び替えてから混ぜるのが要点。画面での選択順は毎回変わりうるので、
 * 順序を残すと「同じ内容なのに違う鍵」になり、二重発行を素通しさせてしまう。
 */
export function computeIdempotencyKey(parts: IdempotencyParts): string {
  const canonical = [
    parts.spaceId,
    parts.docType,
    parts.partnerId,
    parts.issueDate,
    // 金額は小数2桁で正規化（100 と 100.00 を別物にしない）
    parts.subtotal.toFixed(2),
    [...parts.taskIds].sort().join(','),
  ].join('|')

  return createHash('sha256').update(canonical).digest('hex')
}

/** 明細の税抜合計。 */
export function subtotalOf(lines: DocumentLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
}
