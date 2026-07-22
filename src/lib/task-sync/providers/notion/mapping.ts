/**
 * Notion inbound のスキーマ・マッピング — 「Notion DB のどのプロパティを TaskApp のどの意味に
 * 対応づけるか」を接続ごとに保持する（import_config.notion_mappings[databaseId]）。
 *
 * title はここに含めない。Notion の title プロパティは type==='title' で1DBに1つだけ構造的に
 * 一意に決まるため、アダプタ側（providers/notion.ts）が毎回スキーマから自動特定する。
 * ユーザーに選ばせる／保存する対象にすると、リネームやDB複製で「どれが title か」がずれ得るのに
 * わざわざ選択の余地を作ることになり、事故の元になるだけで利点が無い。
 *
 * ⚠ 信頼境界: このマッピングは接続作成/編集ウィザードでユーザーが選んだ時点のスキーマを元にした
 * 「約束」でしかない。Notion 側でプロパティが後から削除・型変更されても TaskApp には通知が来ない
 * （webhookではなくポーリング取り込みのため）。validateMappingAgainstSchema はマッピングの保存API
 * （ウィザードでの確定時。次段で実装）が、確定直前のライブスキーマと突き合わせて drift を弾くために使う
 * 純粋関数。
 *
 * 保存時の検証だけでは不変条件にならない（保存後に顧客が Notion 側を変えても通知が来ないため）。
 * そのため取り込み実行時（providers/notion.ts）も、コンテナのポーリング初回ページ
 * （cursor未指定のとき）に限り1回だけ `fetchDatabaseSchema` でライブスキーマを取り直し、この
 * validateMappingAgainstSchema で再検証する（1ポーリングにつき1コンテナ1回に抑える）。
 * 不合格なら推測で続行せず恒久エラーでそのコンテナの取り込みを止め、再マッピングを求める。
 *
 * 検証は手書き（zod 等の外部ライブラリは使わない）。このコードベースは検証を手書きの流儀で
 * 統一しており（src/lib/connectors/genericPayload.ts の parseGenericInboundEvent 等）、
 * この1ファイルのためだけに本番依存を増やす理由が無い。
 */

import { isValidUuid } from '@/lib/uuid'

/** 完了ステータス側の対応づけ（読み＝取り込み判定 / 書き＝完了時の書き戻し）。 */
export interface NotionStatusMapping {
  /** Notion 側の完了フラグに使うプロパティのID。 */
  prop_id: string
  /** 上記プロパティの型。書式が全く異なるため型ごとに読み書きの実装を分ける。 */
  prop_type: 'status' | 'select' | 'checkbox'
  /**
   * 読み: ページのこのプロパティ値がここに含まれる option id なら completed とみなす。
   * checkbox の場合は使わない（true/false で直接判定するため常に []）。
   */
  done_option_ids: string[]
  /**
   * 書き: TaskApp で完了したとき Notion 側に設定する option id。
   * checkbox の場合は null 固定（true を書くだけで option id という概念が無いため）。
   */
  write_done_option_id: string | null
}

/** import_config.notion_mappings[databaseId] に保存する形。未知フィールドは strip する。 */
export interface NotionMapping {
  /** 期日として取り込むプロパティのID（date型）。null なら期日を取り込まない。 */
  due_prop_id: string | null
  /** 完了同期の対応づけ。null なら完了の取り込み/書き戻しをしない。 */
  status: NotionStatusMapping | null
  /** ユーザーがこのマッピングを確認・確定した時刻（ISO8601）。監査・再確認導線に使う。 */
  confirmed_at: string
}

/** Notion のプロパティのオプション（status/select の選択肢）。 */
export interface NotionLivePropertyOption {
  id: string
  name: string
}

/**
 * Notion `databases.retrieve` が返す `properties` の1要素（検証に要る最小限のフィールドのみ）。
 * キーはプロパティ名（Notion API のレスポンスと同じ形。プロパティ名は変わり得るため、
 * 実際の同一性判定は必ず `id` で行い、名前はUI表示以外に使わない）。
 */
export interface NotionLiveProperty {
  id: string
  type: string
  status?: { options: NotionLivePropertyOption[] }
  select?: { options: NotionLivePropertyOption[] }
}

/** Notion `databases.retrieve` の `properties`（キー=プロパティ名）。 */
export type NotionLiveProperties = Record<string, NotionLiveProperty>

export type MappingValidationResult = { valid: true } | { valid: false; reason: string }

// ---- ここから: notion_mappings[databaseId] に保存された生の値の手書き検証（旧: zod） ----

const PROP_TYPES: readonly NotionStatusMapping['prop_type'][] = ['status', 'select', 'checkbox']

/**
 * prop_id / option_id 系文字列の長さ上限。Notion のプロパティID・option IDは実際には
 * base64風の短い文字列（数十文字程度）だが、上限を設けないと巨大な文字列がそのまま
 * DBのjsonbやログ・エラーメッセージに流れ得る。src/lib/connectors/genericPayload.ts の
 * MAX_ID(255) と同じ考え方・同じ値に揃える（この種のID文字列に255文字を超える正当な値は無い）。
 */
const MAX_ID_LEN = 255

/**
 * status/select プロパティの done_option_ids の件数上限。Notion の select/status
 * プロパティの選択肢数はUI上の運用として実務上数十件程度に収まるが、API仕様として
 * 公開された固定上限は無いため、安全側の余裕を持った値として200を上限に採る
 * （正当な設定がこれを超えることは通常無く、超える場合は入力異常＝DoS/ログ肥大の防止を優先する）。
 */
const MAX_DONE_OPTIONS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** ID系文字列（prop_id・option_id）の検証: 非空・長さ上限内であること。 */
function validIdString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LEN
}

/**
 * Notion のデータベースIDの形式検証。Notion API はハイフン無し32桁hex表記
 * （URLの末尾セグメント等でよく見る形）とハイフン付きUUID表記（databases.retrieve の
 * レスポンス等）の両方を受け付ける表記ゆれがあるため、この2形式のみ受理する。
 * 形式外の巨大な文字列がそのままURL構築（fetchDatabaseSchema）・外部API呼び出し・
 * ログに流れるのを、入口で形式を絞ることで防ぐ。
 */
const NOTION_ID_32HEX_RE = /^[0-9a-f]{32}$/i

export function isValidNotionDatabaseId(value: string): boolean {
  return NOTION_ID_32HEX_RE.test(value) || isValidUuid(value)
}

/**
 * confirmed_at（監査値）の形式検証。ISO8601（ミリ秒付きUTC。他の provider の cursor と同じ形）の
 * 正規表現＋実在する暦日かを見る。`new Date(str)` だけに頼ると `July 1, 2026` のような非ISO表記や
 * `2026-02-30`（3月2日へ自動繰り上げされる）まで妥当として通ってしまうため、形式と暦日を
 * 別々に検証する。値そのものは書き換えない（保存された文字列をそのまま保持する）ため、
 * 日付の生成・表示ではなく CLAUDE.md の toISOString 禁止には抵触しない。
 *
 * 暦日の実在判定は src/lib/connectors/genericPayload.ts の isRealCalendarDate と同じ往復判定
 * （Date.UTC に通して年月日が変わらないかを見る）。既存の検証は手書きの流儀で統一しており
 * （外部ライブラリを増やさない）、この1ファイルのためだけに共有ユーティリティへ切り出すほどの
 * 重複ではないため、同じ小さな判定をここにも持つ。
 */
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/

function isValidIsoDatetime(value: string): boolean {
  const m = ISO_DATETIME_RE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export type StatusMappingParseResult =
  | { ok: true; data: NotionStatusMapping }
  | { ok: false; reason: string }

/** status サブオブジェクトの検証。呼び出し元は NotionMapping.status の parse に使う。 */
function parseNotionStatusMapping(raw: unknown): StatusMappingParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'status must be an object' }

  if (!validIdString(raw.prop_id)) {
    return { ok: false, reason: `status.prop_id must be a non-empty string of at most ${MAX_ID_LEN} characters` }
  }
  if (typeof raw.prop_type !== 'string' || !PROP_TYPES.includes(raw.prop_type as NotionStatusMapping['prop_type'])) {
    return { ok: false, reason: `status.prop_type must be one of ${PROP_TYPES.join(', ')}` }
  }
  const propType = raw.prop_type as NotionStatusMapping['prop_type']
  if (!Array.isArray(raw.done_option_ids) || !raw.done_option_ids.every((id) => validIdString(id))) {
    return {
      ok: false,
      reason: `status.done_option_ids must be an array of non-empty strings of at most ${MAX_ID_LEN} characters`,
    }
  }
  if (raw.done_option_ids.length > MAX_DONE_OPTIONS) {
    // 巨大配列(DoS/ログ肥大対策)。実在するNotionのoption数がこれを超えることは通常無い。
    return { ok: false, reason: `status.done_option_ids must have at most ${MAX_DONE_OPTIONS} entries` }
  }
  const rawDoneOptionIds = raw.done_option_ids as string[]
  // 重複は実行結果に影響しない（isCompleted は includes() で判定するため、同じ id が
  // 2回あっても1回あっても判定結果は変わらない）。コンテナ全体（期日取り込み含む）を
  // 止めるほどの違反ではないので、Set で一意化して受理する（保存前提のウィザードに直させず、
  // ここで静かに正規化するのが最も無害）。
  let doneOptionIds = Array.from(new Set(rawDoneOptionIds))
  if (propType === 'checkbox') {
    // checkbox は true/false で直接判定するため option id という概念が無い。非空でも実害は無い
    // （isCompleted は checkbox 型のとき done_option_ids を一切参照しない）ため、拒否はせず
    // 空配列へ正規化して受理する。
    doneOptionIds = []
  } else {
    // status/select: 空配列だと「完了とみなす選択肢が無い」＝どのページも永久に completed=false
    // になる（完了同期が付いているのに一生発火しない設定不備）。これは実害があるため維持する。
    // 完了同期をしないなら status 自体を null にする契約（parseNotionMapping 側）。
    if (doneOptionIds.length === 0) {
      return {
        ok: false,
        reason: 'status.done_option_ids must have at least one entry for status/select (use status: null for no completion sync)',
      }
    }
  }
  if (raw.write_done_option_id !== null && !validIdString(raw.write_done_option_id)) {
    return {
      ok: false,
      reason: `status.write_done_option_id must be a non-empty string of at most ${MAX_ID_LEN} characters, or null`,
    }
  }

  return {
    ok: true,
    data: {
      prop_id: raw.prop_id,
      prop_type: propType,
      done_option_ids: doneOptionIds,
      write_done_option_id: raw.write_done_option_id,
    },
  }
}

export type NotionMappingParseResult = { ok: true; data: NotionMapping } | { ok: false; reason: string }

/**
 * notion_mappings[databaseId] の生の値（DBのjsonb由来。何の保証も無い unknown）を検証・正規化する。
 * 未知フィールドは strip し（既知フィールドだけを組み立てて返すため自然に落ちる）、
 * 型が違えば理由付きで拒否する。
 */
export function parseNotionMapping(raw: unknown): NotionMappingParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'mapping must be an object' }

  if (raw.due_prop_id !== null && !validIdString(raw.due_prop_id)) {
    return {
      ok: false,
      reason: `due_prop_id must be a non-empty string of at most ${MAX_ID_LEN} characters, or null`,
    }
  }

  let status: NotionStatusMapping | null = null
  if (raw.status !== null) {
    if (raw.status === undefined) {
      return { ok: false, reason: 'status is required (use null for no completion sync)' }
    }
    const parsed = parseNotionStatusMapping(raw.status)
    if (!parsed.ok) return parsed
    status = parsed.data
  }

  if (!nonEmptyString(raw.confirmed_at)) {
    return { ok: false, reason: 'confirmed_at must be a non-empty string' }
  }
  // confirmed_at は監査値（ユーザーがこのマッピングを確認・確定した時刻）。形式(ISO8601)と
  // 暦日の実在の両方を検証する（値そのものは書き換えない＝ raw.confirmed_at をそのまま保持する。
  // 日付の生成・表示・変換には使わないため CLAUDE.md の toISOString 禁止には抵触しない）。
  if (!isValidIsoDatetime(raw.confirmed_at)) {
    return { ok: false, reason: 'confirmed_at must be a valid ISO8601 datetime string' }
  }

  return {
    ok: true,
    data: {
      due_prop_id: raw.due_prop_id,
      status,
      confirmed_at: raw.confirmed_at,
    },
  }
}

// ---- ここから: マッピングをライブスキーマ(databases.retrieve)に対して検証する ----

/** id で一致するプロパティを探す（名前はリネームされ得るため使わない）。 */
function findPropertyById(liveProps: NotionLiveProperties, propId: string): NotionLiveProperty | null {
  for (const prop of Object.values(liveProps)) {
    if (prop.id === propId) return prop
  }
  return null
}

/** status/select プロパティの選択肢一覧を取り出す（型によって options の置き場所が違う）。 */
function optionsOf(prop: NotionLiveProperty): NotionLivePropertyOption[] {
  return prop.status?.options ?? prop.select?.options ?? []
}

/**
 * マッピングを「今のNotion DBスキーマ」に対して検証する（最重要・信頼境界）。
 *
 * マッピングの保存API（ウィザードでの確定時。次段で実装）から呼ばれる想定の純粋関数だが、
 * 取り込み実行時（providers/notion.ts の listChangedTasks）からも、コンテナのポーリング初回ページ
 * （cursor未指定のとき）に限り1回だけ再利用される（実行時のdrift再検証。1ポーリングにつき
 * 1コンテナ1回に抑えるため、2ページ目以降では呼ばない）。
 * 不合格の場合は「どのフィールドがなぜ不正か」を reason に含める（保存APIのエラー表示、および
 * 取り込み停止時のエラーメッセージにそのまま使える）。
 */
export function validateMappingAgainstSchema(
  mapping: NotionMapping,
  liveProps: NotionLiveProperties,
): MappingValidationResult {
  if (mapping.due_prop_id !== null) {
    const prop = findPropertyById(liveProps, mapping.due_prop_id)
    if (!prop) {
      return { valid: false, reason: `due_prop_id: プロパティが見つかりません(id=${mapping.due_prop_id})` }
    }
    if (prop.type !== 'date') {
      return {
        valid: false,
        reason: `due_prop_id: date型ではありません(id=${mapping.due_prop_id}, 実際の型=${prop.type})`,
      }
    }
  }

  if (mapping.status !== null) {
    const { prop_id, prop_type, done_option_ids, write_done_option_id } = mapping.status
    const prop = findPropertyById(liveProps, prop_id)
    if (!prop) {
      return { valid: false, reason: `status.prop_id: プロパティが見つかりません(id=${prop_id})` }
    }
    if (prop.type !== prop_type) {
      return {
        valid: false,
        reason: `status.prop_type: 実際の型と一致しません(id=${prop_id}, 宣言=${prop_type}, 実際=${prop.type})`,
      }
    }

    if (prop_type === 'checkbox') {
      // checkbox に option id という概念は無い。書き戻しは true を書くだけなので null 固定のはず。
      if (write_done_option_id !== null) {
        return {
          valid: false,
          reason: 'status.write_done_option_id: checkbox 型では null 以外を指定できません',
        }
      }
      // done_option_ids も同じ理由で checkbox では空配列必須（任意の文字列配列を通すと、
      // parseNotionMapping を経由しない保存経路があった場合に不整合な値が紛れ込める）。
      if (done_option_ids.length !== 0) {
        return {
          valid: false,
          reason: 'status.done_option_ids: checkbox 型では空配列以外を指定できません',
        }
      }
    } else {
      // status/select: 空配列は「完了とみなす選択肢が無い」＝全ページが永久にcompleted=falseになる
      // 設定不備。完了同期をしないなら status 自体を null にする契約なので、ここでは1件以上必須。
      if (done_option_ids.length === 0) {
        return {
          valid: false,
          reason: 'status.done_option_ids: status/select 型では最低1件必要です(完了同期しないなら status を null にしてください)',
        }
      }
      // done_option_ids / write_done_option_id が実在する option の id か検証する。
      const optionIds = new Set(optionsOf(prop).map((o) => o.id))
      const missingDone = done_option_ids.filter((id) => !optionIds.has(id))
      if (missingDone.length > 0) {
        return {
          valid: false,
          reason: `status.done_option_ids: 実在しない option id が含まれます(${missingDone.join(', ')})`,
        }
      }
      if (write_done_option_id !== null && !optionIds.has(write_done_option_id)) {
        return {
          valid: false,
          reason: `status.write_done_option_id: 実在しない option id です(${write_done_option_id})`,
        }
      }
    }
  }

  return { valid: true }
}
