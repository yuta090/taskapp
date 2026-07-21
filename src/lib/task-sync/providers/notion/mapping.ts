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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export type StatusMappingParseResult =
  | { ok: true; data: NotionStatusMapping }
  | { ok: false; reason: string }

/** status サブオブジェクトの検証。呼び出し元は NotionMapping.status の parse に使う。 */
function parseNotionStatusMapping(raw: unknown): StatusMappingParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'status must be an object' }

  if (!nonEmptyString(raw.prop_id)) {
    return { ok: false, reason: 'status.prop_id must be a non-empty string' }
  }
  if (typeof raw.prop_type !== 'string' || !PROP_TYPES.includes(raw.prop_type as NotionStatusMapping['prop_type'])) {
    return { ok: false, reason: `status.prop_type must be one of ${PROP_TYPES.join(', ')}` }
  }
  const propType = raw.prop_type as NotionStatusMapping['prop_type']
  if (!Array.isArray(raw.done_option_ids) || !raw.done_option_ids.every((id) => typeof id === 'string')) {
    return { ok: false, reason: 'status.done_option_ids must be an array of strings' }
  }
  const doneOptionIds = raw.done_option_ids as string[]
  if (new Set(doneOptionIds).size !== doneOptionIds.length) {
    return { ok: false, reason: 'status.done_option_ids must not contain duplicates' }
  }
  if (propType === 'checkbox') {
    // checkbox は true/false で直接判定するため option id という概念が無い。空配列必須。
    if (doneOptionIds.length !== 0) {
      return { ok: false, reason: 'status.done_option_ids must be empty for checkbox (no option id concept)' }
    }
  } else {
    // status/select: 空配列だと「完了とみなす選択肢が無い」＝どのページも永久に completed=false
    // になる（完了同期が付いているのに一生発火しない設定不備）。完了同期をしないなら
    // status 自体を null にする契約（parseNotionMapping 側）なので、ここに来た以上1件以上必須。
    if (doneOptionIds.length === 0) {
      return {
        ok: false,
        reason: 'status.done_option_ids must have at least one entry for status/select (use status: null for no completion sync)',
      }
    }
  }
  if (raw.write_done_option_id !== null && typeof raw.write_done_option_id !== 'string') {
    return { ok: false, reason: 'status.write_done_option_id must be a string or null' }
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

  if (raw.due_prop_id !== null && !nonEmptyString(raw.due_prop_id)) {
    return { ok: false, reason: 'due_prop_id must be a non-empty string or null' }
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
  // confirmed_at は監査値（ユーザーがこのマッピングを確認・確定した時刻）。ISO8601として妥当かだけ
  // を Date に通して見る（値そのものは書き換えない＝ raw.confirmed_at をそのまま保持する。
  // 日付の生成・表示・変換には使わないため CLAUDE.md の toISOString 禁止には抵触しない）。
  if (Number.isNaN(new Date(raw.confirmed_at).getTime())) {
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
