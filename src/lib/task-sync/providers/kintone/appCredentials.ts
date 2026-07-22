import { MAX_API_TOKENS_PER_REQUEST } from '@/lib/task-sync/providers/kintone/client'
import { isValidKintoneAppId } from '@/lib/task-sync/providers/kintone/mapping'

/**
 * kintone接続作成時、アプリID一覧(kintone_app_ids)とAPIキー(カンマ結合トークン)の対応づけを
 * 検証する（POST /api/integrations/connections/task-sync の kintone専用ゲート）。
 *
 * ⚠ 経緯（Codexレビュー指摘・Critical「正本を欠いた接続を成功扱いにできる」）:
 *   過去の実装は「トークン数とアプリID数が一致するときだけ」kintone_app_tokens
 *   （app_idをキーにした、アプリ単位で個別に暗号化したkintone APIトークンのjsonbオブジェクト。
 *   「どのトークンがどのアプリのものか」の正本。20260723014852_kintone_apps_merge_rpc.sql参照）を
 *   best-effortで作り、一致しなければ**作らずに接続を201で作成**していた。この結果
 *   kintone_app_ids と access_token_encrypted(カンマ結合の複合blob)はあるのに正本が無い
 *   「死んだ接続」ができ、以後のアプリ追加/削除(kintone/apps/route.ts)が KTGAP で恒久停止し、
 *   どのトークンがどのアプリのものか復元不能になっていた。これは私たちが潰してきた「死んだ接続」
 *   そのものであり、以後は不一致を接続作成の時点で拒否する（このアダプタが依存する
 *   「apiKey(カンマ結合)とkintone_app_idsが同じ1リクエスト内で同じ行配列から同時に組み立てられた」
 *   という契約は、この検証を通ったときだけ信用してよい）。
 *
 * 検証は手書き（zod 等の外部ライブラリは使わない。既存の provider 実装と同じ流儀）。
 */

/** APIトークン1件あたりの長さ上限。kintoneのAPIトークンは実務上40〜数十文字程度だが、巨大な
 * 文字列がそのままDBのjsonbやログ・エラーメッセージに流れないよう安全側の上限を設ける。 */
const MAX_TOKEN_LEN = 200

/** 制御文字（改行・タブ等）。トークンに混入すると HTTPヘッダ組み立て(client.ts)やログ出力で
 * 想定外の挙動を招くため、値として受理しない。 */
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/

export type KintoneAppCredentialsResult =
  | { ok: true; appIds: string[]; tokens: string[] }
  | { ok: false; reason: string }

export type KintoneTokenValidationResult = { ok: true } | { ok: false; reason: string }

/**
 * 単一のkintone APIトークンの形式検証（長さ上限・制御文字）。接続作成時(validateKintoneAppCredentials
 * による複数トークン一括検証)と、接続後の単一アプリ追加(kintone/apps/route.ts)の両方から呼ばれる
 * 共通の門番。以前はアプリ追加APIにこの上限が無く、ボディサイズ上限(8KB)で間接的に縛られている
 * だけだった（接続作成時のvalidateKintoneAppCredentialsだけがMAX_TOKEN_LEN/制御文字を検証していた
 * 非対称）。二重定義を避けるため、両者はこの関数を共有する。
 */
export function validateKintoneApiToken(token: string): KintoneTokenValidationResult {
  if (token.length === 0) {
    return { ok: false, reason: 'APIトークンを入力してください' }
  }
  if (CONTROL_CHAR_RE.test(token)) {
    return { ok: false, reason: 'APIトークンに使用できない文字（制御文字）が含まれています' }
  }
  if (token.length > MAX_TOKEN_LEN) {
    return { ok: false, reason: `APIトークンは1件あたり最大${MAX_TOKEN_LEN}文字までです` }
  }
  return { ok: true }
}

/**
 * rawAppIds（providerConfig.kintone_app_ids。何の保証も無い unknown）と apiKey（フォームで
 * カンマ区切りされたAPIトークン文字列）を検証し、両者が**完全に同じ件数**であることを確認する。
 * 一致しない・アプリIDの形式が不正・重複・上限超過・トークンが不正な場合は理由付きで拒否する
 * （黙って一部を捨てて位置対応を推測することはしない＝呼び出し側が誤って保存しないための門番）。
 */
export function validateKintoneAppCredentials(rawAppIds: unknown, apiKey: string): KintoneAppCredentialsResult {
  if (!Array.isArray(rawAppIds)) {
    return {
      ok: false,
      reason: 'kintoneはアプリIDを1つ以上指定してください（1つも指定しない接続は取り込みが永久に始まりません）',
    }
  }

  const appIds: string[] = []
  for (const raw of rawAppIds) {
    const s =
      typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
    if (!s || !isValidKintoneAppId(s)) {
      return {
        ok: false,
        reason: 'kintone_app_ids に不正な値が含まれています（数値のみ・20桁以内で指定してください）',
      }
    }
    appIds.push(s)
  }

  if (appIds.length === 0) {
    return {
      ok: false,
      reason: 'kintoneはアプリIDを1つ以上指定してください（1つも指定しない接続は取り込みが永久に始まりません）',
    }
  }
  if (new Set(appIds).size !== appIds.length) {
    return { ok: false, reason: 'kintone_app_ids に重複があります（同じアプリを2度指定できません）' }
  }
  if (appIds.length > MAX_API_TOKENS_PER_REQUEST) {
    return {
      ok: false,
      reason: `kintoneのアプリは1接続につき最大${MAX_API_TOKENS_PER_REQUEST}個までです`,
    }
  }

  // トークンはカンマで分割する契約（KintoneConnectForm.tsx が同じ行配列から同時に組み立てる）。
  // 分割後の各要素をtrimする（前後の空白はコピペ由来のことが多く、ここで弾くとUXが悪いだけで
  // 安全性は上がらない）。ただし空要素（連続カンマ・末尾カンマ）は拒否する＝カンマの数が
  // アプリIDの個数と合っていないことの明確な兆候であり、黙って詰めると位置対応がずれる。
  const tokens = apiKey.split(',').map((t) => t.trim())
  if (tokens.some((t) => t.length === 0)) {
    return {
      ok: false,
      reason: 'APIトークンに空の項目が含まれています（カンマの数がアプリIDの個数と合っているか確認してください）',
    }
  }
  // 個々のトークンの形式検証（長さ上限・制御文字）は validateKintoneApiToken に委譲する
  // （kintone/apps/route.ts の単一トークン追加と二重定義しないため）。空チェックは上で
  // 既に済ませているため、ここで validateKintoneApiToken が空文字を理由に拒否することはない。
  for (const t of tokens) {
    const tokenCheck = validateKintoneApiToken(t)
    if (!tokenCheck.ok) return { ok: false, reason: tokenCheck.reason }
  }

  if (tokens.length !== appIds.length) {
    return {
      ok: false,
      reason:
        `APIトークンの数(${tokens.length})とアプリIDの数(${appIds.length})が一致しません。` +
        'カンマ区切りのAPIトークンとアプリIDは同じ順番・同じ件数で入力してください',
    }
  }

  return { ok: true, appIds, tokens }
}
