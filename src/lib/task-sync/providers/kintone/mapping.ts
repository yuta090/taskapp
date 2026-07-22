/**
 * kintone inbound のスキーマ・マッピング — 「kintoneアプリのどのフィールドを TaskApp のどの意味に
 * 対応づけるか」を接続ごとに保持する（import_config.kintone_mappings[appId]）。
 *
 * ⚠ Notion との決定的な違い（kintone固有の制約。ここが今回の設計の勘所）:
 *   kintone の選択肢系フィールド（DROP_DOWN/RADIO_BUTTON/CHECK_BOX）は
 *   `options: { "<選択肢名>": { label, index } }` と**選択肢名がキー**であり、Notion の
 *   option id のような「リネームされない安定したID」が存在しない。STATUS（プロセス管理の
 *   ステータス）に至っては、値そのものが選択肢名の文字列で返る（`{"type":"STATUS","value":"未着手"}`。
 *   公式: kintone REST API Field Types）。したがって kintone では**フィールドコード
 *   （code。label=表示名とは違い安定した識別子）＋選択肢名（文字列）**で対応づけるしかない。
 *   ＝ **運用者が選択肢の名前を変更すると、この対応づけは壊れる**（Notion の option id 方式なら
 *   壊れない）。この制約は選べる設計ではなく kintone API の構造的な制約であり、ここに明記して
 *   ウィザード（別PR）の注意書きに引き継ぐ。
 *
 * title はここに含める（Notion と異なり必須）。kintone には「構造的に1つだけ存在するtitle型」が
 * 無いため、どのフィールドをタイトルとして使うかを必ずユーザーに選ばせる必要がある。
 *
 * ⚠ 信頼境界: このマッピングは接続作成/編集ウィザードでユーザーが選んだ時点のスキーマを元にした
 * 「約束」でしかない。kintone 側でフィールドが後から削除・型変更されても TaskApp には通知が来ない
 * （webhookではなくポーリング取り込みのため）。validateMappingAgainstSchema はマッピングの保存API
 * （ウィザード確定時。別PR）と、取り込み実行時（providers/kintone.ts のポーリング初回ページ）の
 * 両方から呼ばれる想定の純粋関数（Notion と同じ2段構えの drift 検知。詳細は providers/kintone.ts
 * のコメント参照）。
 *
 * 検証は手書き（zod 等の外部ライブラリは使わない。既存の provider 実装と同じ流儀）。
 */

/** kintone の選択肢系フィールドで「完了」の対応づけに使える型。 */
export type KintoneStatusFieldType = 'STATUS' | 'DROP_DOWN' | 'RADIO_BUTTON' | 'CHECK_BOX'

const STATUS_FIELD_TYPES: readonly KintoneStatusFieldType[] = ['STATUS', 'DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX']

/** 完了ステータス側の対応づけ（読み＝取り込み判定 / 書き＝完了時の書き戻し）。 */
export interface KintoneStatusMapping {
  /** kintone 側の完了フラグに使うフィールドコード。 */
  field_code: string
  /**
   * 上記フィールドの型。STATUS/DROP_DOWN/RADIO_BUTTON は値が文字列、CHECK_BOX は文字列配列
   * （複数選択）で返るため型ごとに読み取りの実装を分ける（providers/kintone.ts 側）。
   */
  field_type: KintoneStatusFieldType
  /**
   * 読み: レコードのこのフィールド値がここに含まれる選択肢名なら completed とみなす
   * （CHECK_BOX は値配列とこの集合の積が空でなければ completed）。
   *
   * ⚠ 選択肢名で対応づけるため、kintone側で選択肢の表示名を変更するとこの対応は壊れる
   * （ファイル冒頭の注意参照）。
   */
  done_values: string[]
  /**
   * 書き: TaskApp で完了したとき実行する、プロセス管理の「アクション」名。null=完了書き戻しなし。
   *
   * ⚠ **field_type === 'STATUS' のときだけ非nullにできる**（それ以外の型で非nullなら
   * parseKintoneStatusMapping / validateMappingAgainstSchema が拒否する）。
   * 理由: kintone は STATUS（プロセス管理）フィールドの値を通常のレコード更新APIでは書けず
   * （公式: Field Types「Status (Process management status): Values for this field cannot be
   * created or updated」）、専用の Update Status API（プロセス管理のアクション実行）でのみ前進できる。
   * 書き戻し(completeTask)は常にこのアクション実行APIを使うため、更新されるのは STATUS フィールド
   * だけであり、マッピング先が DROP_DOWN/RADIO_BUTTON/CHECK_BOX のときに書き戻しを許すと
   * 「書き戻し成功に見えるのにマッピング先は変わらず、次の取り込みで未完了に戻る」という
   * 無言の不整合になる。詳細は parseKintoneStatusMapping の同名の注意書きを参照。
   */
  write_done_action: string | null
}

/** import_config.kintone_mappings[appId] に保存する形。未知フィールドは strip する。 */
export interface KintoneMapping {
  /** タイトルとして取り込むフィールドコード。kintoneには構造的なtitleが無いため必須。 */
  title_field_code: string
  /** 期日として取り込むフィールドコード（DATE型）。null なら期日を取り込まない。 */
  due_field_code: string | null
  /**
   * 完了同期の対応づけ。null なら完了の取り込み/書き戻しをしない。
   *
   * ⚠ プロセス管理（STATUSフィールド）を使っていないアプリでは完了同期ができない。この場合
   * status を null にすることを**明示的に選ばせる**契約とし、ウィザード側で黙って無効化しない
   * （「なぜ完了が同期されないか」を運用者が把握できるようにするため）。
   */
  status: KintoneStatusMapping | null
  /** ユーザーがこのマッピングを確認・確定した時刻（ISO8601）。監査・再確認導線に使う。 */
  confirmed_at: string
}

/** kintone `app/form/fields.json` の1フィールドの、検証に要る最小限の正規化形（schema.ts が作る）。 */
export interface KintoneLiveField {
  code: string
  type: string
  label: string
  /** DROP_DOWN/RADIO_BUTTON/CHECK_BOX のときだけ選択肢名の配列を持つ。STATUSは持たない
   * （STATUSの取り得る値はプロセス管理設定側にあり、fields.json には現れないため）。 */
  options?: string[]
}

export type MappingValidationResult = { valid: true } | { valid: false; reason: string }

// ---- ここから: kintone_mappings[appId] に保存された生の値の手書き検証 ----

/**
 * field_code / write_done_action / done_values の1件あたりの長さ上限。kintoneのフィールドコードは
 * 実務上せいぜい数十〜百数十文字程度だが、上限を設けないと巨大な文字列がそのまま DBのjsonbや
 * ログ・エラーメッセージに流れ得る。既存 provider（notion/mapping.ts の MAX_ID_LEN）と同じ考え方・
 * 同じ値に揃える。
 */
const MAX_ID_LEN = 255

/**
 * done_values の件数上限。kintoneの選択肢数はUI運用上実務上数十件程度に収まるが、API仕様上の
 * 固定上限は公開されていないため、安全側の余裕を持った値として200を上限に採る
 * （notion/mapping.ts の MAX_DONE_OPTIONS と同じ考え方・同じ値）。
 */
const MAX_DONE_VALUES = 200

/** アプリID（kintoneのappパラメータ）の形式。数値文字列のみ許可する（公式: appは Integer or String）。 */
const APP_ID_RE = /^\d+$/

export function isValidKintoneAppId(value: string): boolean {
  return APP_ID_RE.test(value) && value.length <= 20 // 桁溢れ防止(kintoneのappIdは実務上10桁未満)
}

/**
 * 生の値(config.kintone_app_ids。DBのjsonb由来で何の保証も無い unknown)から、妥当な
 * アプリIDだけを取り出し重複を除いて返す。
 *
 * providers/kintone.ts の listContainers/listChangedTasks（アダプタ本体）と、接続作成時の
 * サーバ側検証（アプリIDが1件も無い接続を作らせないゲート。POST /api/integrations/connections/
 * task-sync/route.ts）の両方から使う共通の正規化ロジック（重複実装による drift を避けるため
 * ここに一本化する）。
 */
export function normalizeKintoneAppIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : null
    if (s && isValidKintoneAppId(s)) out.push(s)
  }
  return Array.from(new Set(out))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** field_code / write_done_action / 選択肢名の検証: 非空・長さ上限内であること。 */
function validIdString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LEN
}

/**
 * confirmed_at（監査値）の形式検証。ISO8601（ミリ秒付きUTC等）の正規表現＋実在する暦日かを見る。
 * notion/mapping.ts の isValidIsoDatetime と同じ手書き判定（外部ライブラリを増やさない）。
 * 値そのものは書き換えないため、日付の生成・表示ではなく CLAUDE.md の toISOString 禁止には
 * 抵触しない。
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
  | { ok: true; data: KintoneStatusMapping }
  | { ok: false; reason: string }

/** status サブオブジェクトの検証。呼び出し元は KintoneMapping.status の parse に使う。 */
function parseKintoneStatusMapping(raw: unknown): StatusMappingParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'status must be an object' }

  if (!validIdString(raw.field_code)) {
    return {
      ok: false,
      reason: `status.field_code must be a non-empty string of at most ${MAX_ID_LEN} characters`,
    }
  }
  if (typeof raw.field_type !== 'string' || !STATUS_FIELD_TYPES.includes(raw.field_type as KintoneStatusFieldType)) {
    return { ok: false, reason: `status.field_type must be one of ${STATUS_FIELD_TYPES.join(', ')}` }
  }
  const fieldType = raw.field_type as KintoneStatusFieldType

  if (!Array.isArray(raw.done_values) || !raw.done_values.every((v) => validIdString(v))) {
    return {
      ok: false,
      reason: `status.done_values must be an array of non-empty strings of at most ${MAX_ID_LEN} characters`,
    }
  }
  if (raw.done_values.length > MAX_DONE_VALUES) {
    return { ok: false, reason: `status.done_values must have at most ${MAX_DONE_VALUES} entries` }
  }
  // どの field_type でも「完了とみなす選択肢が無い」設定は、全レコードが永久にcompleted=falseに
  // なる設定不備（notion と同じ理由）。完了同期をしないなら status 自体を null にする契約。
  const doneValues = Array.from(new Set(raw.done_values as string[]))
  if (doneValues.length === 0) {
    return {
      ok: false,
      reason: 'status.done_values must have at least one entry (use status: null for no completion sync)',
    }
  }

  if (raw.write_done_action !== null && !validIdString(raw.write_done_action)) {
    return {
      ok: false,
      reason: `status.write_done_action must be a non-empty string of at most ${MAX_ID_LEN} characters, or null`,
    }
  }
  // ⚠ write_done_action(プロセス管理のアクション実行)を指定できるのは field_type==='STATUS' のときだけ。
  //   completeTask(providers/kintone.ts)の書き戻しは常にプロセス管理の Update Status API を使い、
  //   これが更新するのは STATUS フィールドの値のみ（公式: Field Types「Status (Process management
  //   status): Values for this field cannot be created or updated」＝通常のレコード更新APIでは書けない
  //   一方で、マッピングされた選択肢フィールド(DROP_DOWN/RADIO_BUTTON/CHECK_BOX)はそもそも別物）。
  //   DROP_DOWN等でwrite_done_actionを許すと「TaskAppで完了→書き戻し成功(に見える)→実際は
  //   マッピングされた選択肢フィールドが更新されず→次の取り込みで未完了と判定→完了が永久に
  //   定着しない」という無言の不整合になるため、parse時点で拒否する。
  if (fieldType !== 'STATUS' && raw.write_done_action !== null) {
    return {
      ok: false,
      reason:
        'status.write_done_action can only be set when status.field_type is STATUS ' +
        '(non-STATUS choice fields are read-only for completion sync; use null)',
    }
  }

  return {
    ok: true,
    data: {
      field_code: raw.field_code,
      field_type: fieldType,
      done_values: doneValues,
      write_done_action: raw.write_done_action,
    },
  }
}

export type KintoneMappingParseResult = { ok: true; data: KintoneMapping } | { ok: false; reason: string }

/**
 * kintone_mappings[appId] の生の値（DBのjsonb由来。何の保証も無い unknown）を検証・正規化する。
 * 未知フィールドは strip し（既知フィールドだけを組み立てて返すため自然に落ちる）、
 * 型が違えば理由付きで拒否する。
 */
export function parseKintoneMapping(raw: unknown): KintoneMappingParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'mapping must be an object' }

  if (!validIdString(raw.title_field_code)) {
    return {
      ok: false,
      reason: `title_field_code must be a non-empty string of at most ${MAX_ID_LEN} characters`,
    }
  }

  if (raw.due_field_code !== null && !validIdString(raw.due_field_code)) {
    return {
      ok: false,
      reason: `due_field_code must be a non-empty string of at most ${MAX_ID_LEN} characters, or null`,
    }
  }

  let status: KintoneStatusMapping | null = null
  if (raw.status !== null) {
    if (raw.status === undefined) {
      return { ok: false, reason: 'status is required (use null for no completion sync)' }
    }
    const parsed = parseKintoneStatusMapping(raw.status)
    if (!parsed.ok) return parsed
    status = parsed.data
  }

  if (!nonEmptyString(raw.confirmed_at)) {
    return { ok: false, reason: 'confirmed_at must be a non-empty string' }
  }
  if (!isValidIsoDatetime(raw.confirmed_at)) {
    return { ok: false, reason: 'confirmed_at must be a valid ISO8601 datetime string' }
  }

  return {
    ok: true,
    data: {
      title_field_code: raw.title_field_code,
      due_field_code: raw.due_field_code,
      status,
      confirmed_at: raw.confirmed_at,
    },
  }
}

// ---- ここから: マッピングをライブスキーマ(fields.json)に対して検証する ----

/** field_code で一致するフィールドを探す。 */
function findFieldByCode(liveFields: readonly KintoneLiveField[], code: string): KintoneLiveField | null {
  return liveFields.find((f) => f.code === code) ?? null
}

/**
 * マッピングを「今のkintoneアプリのフィールド定義(fields.json)」に対して検証する
 * （最重要・信頼境界）。
 *
 * ⚠ 検証できる範囲の限界（正直に書く。推測で「検証済み」を偽らないため）:
 *   - status.field_type==='STATUS' のとき、done_values が実在する値かは**検証できない**。
 *     STATUSフィールドの取り得る値（プロセス管理のステータス名）は fields.json には現れず、
 *     別API「Get Process Management Settings」（本PRのスコープ外）でしか取得できないため。
 *     ここでは field_code の実在と型一致までを検証し、done_values の中身は信頼するしかない
 *     （実行時に取り込んだレコードの値と突き合わせても一致しなければ単に completed=false に
 *     なるだけで、無言の誤動作にはならない）。
 *   - write_done_action（プロセス管理のアクション名）が実在するかも同じ理由で検証できない
 *     （アクション名の一覧も fields.json には無い）。実在しない場合は completeTask 実行時に
 *     kintone 側がエラーを返し、そこで顕在化する。
 *   - 上記2点以外（title_field_code/due_field_code の実在・型、status.field_code の実在・型、
 *     DROP_DOWN/RADIO_BUTTON/CHECK_BOX の done_values が実在する選択肢名か）は fields.json だけで
 *     完全に検証できる。
 */
export function validateMappingAgainstSchema(
  mapping: KintoneMapping,
  liveFields: readonly KintoneLiveField[],
): MappingValidationResult {
  const titleField = findFieldByCode(liveFields, mapping.title_field_code)
  if (!titleField) {
    return { valid: false, reason: `title_field_code: フィールドが見つかりません(code=${mapping.title_field_code})` }
  }

  if (mapping.due_field_code !== null) {
    const prop = findFieldByCode(liveFields, mapping.due_field_code)
    if (!prop) {
      return { valid: false, reason: `due_field_code: フィールドが見つかりません(code=${mapping.due_field_code})` }
    }
    if (prop.type !== 'DATE') {
      return {
        valid: false,
        reason: `due_field_code: DATE型ではありません(code=${mapping.due_field_code}, 実際の型=${prop.type})`,
      }
    }
  }

  if (mapping.status !== null) {
    const { field_code, field_type, done_values, write_done_action } = mapping.status
    const prop = findFieldByCode(liveFields, field_code)
    if (!prop) {
      return { valid: false, reason: `status.field_code: フィールドが見つかりません(code=${field_code})` }
    }
    if (prop.type !== field_type) {
      return {
        valid: false,
        reason: `status.field_type: 実際の型と一致しません(code=${field_code}, 宣言=${field_type}, 実際=${prop.type})`,
      }
    }

    // ⚠ 防御的二重チェック(parseKintoneMappingと同じ制約): write_done_actionはSTATUS型でのみ許す。
    //   通常はparse時点で拒否されるため新規保存では起こり得ないが、この制約導入前に保存された
    //   既存データ（DBのjsonbを直接経由した場合も含む）に対する drift 検証としても効かせる。
    if (write_done_action !== null && field_type !== 'STATUS') {
      return {
        valid: false,
        reason: `status.write_done_action: STATUS型以外(実際=${field_type})では書き戻し(write_done_action)を設定できません`,
      }
    }

    if (field_type !== 'STATUS') {
      // DROP_DOWN/RADIO_BUTTON/CHECK_BOX は fields.json の options に選択肢名一覧があるため検証できる。
      const optionNames = new Set(prop.options ?? [])
      const missing = done_values.filter((v) => !optionNames.has(v))
      if (missing.length > 0) {
        return {
          valid: false,
          reason: `status.done_values: 実在しない選択肢名が含まれます(${missing.join(', ')})`,
        }
      }
    }
    // field_type==='STATUS' のときは done_values / write_done_action を検証できない
    // （上のコメント参照。fields.json だけでは判断材料が無い）。
  }

  return { valid: true }
}
