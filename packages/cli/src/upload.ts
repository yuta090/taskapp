/**
 * `agentpm file upload` の中身。Web(FilesPageClient)と同じ 3 段階でアップロードする:
 *   1. file_upload_url  … サーバーが files に pending 行を作り、Storage の署名URLを返す
 *   2. 署名URLへ実バイトを PUT（API サーバーを経由しない → 50MB まで送れる）
 *   3. file_upload_complete … サーバーが Storage の実体を確認して ready にする
 *
 * 依存（API 呼び出し・fetch・ファイル読み込み）は引数で差し替えられるようにし、テストで固定する。
 */
import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

/** サーバー側(files.ts / upload-url route)と同じ上限 */
export const MAX_UPLOAD_BYTES = 52428800

const MIME_BY_EXT: Record<string, string> = {
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function guessMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export interface UploadDeps {
  callTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** sizeBytes を返さないときは bytes.length を使う（テストで巨大バッファを作らないための逃げ道） */
  readFile: (path: string) => Promise<{ bytes: Buffer; baseName: string; sizeBytes?: number }>
}

export interface UploadOptions {
  filePath: string
  spaceId: string
  /** 省略時はファイル名そのまま */
  name?: string
  /** 省略時は拡張子から推定 */
  mimeType?: string
  /** 署名URLを返すツール名（manifest の tool） */
  tool: string
  /** 完了を確定するツール名（manifest の completeTool） */
  completeTool: string
}

interface UploadUrlResult {
  fileId: string
  signedUrl: string
  token: string
  path: string
  maxBytes?: number
}

export const defaultUploadDeps: Omit<UploadDeps, 'callTool'> = {
  fetch: (url, init) => fetch(url, init),
  readFile: async (path) => {
    const info = await fsStat(path)
    if (!info.isFile()) throw new Error(`ファイルではありません: ${path}`)
    // 上限超えは読み込む前に弾けるよう、サイズを先に返す
    if (info.size > MAX_UPLOAD_BYTES) return { bytes: Buffer.alloc(0), baseName: basename(path), sizeBytes: info.size }
    const bytes = await fsReadFile(path)
    return { bytes, baseName: basename(path), sizeBytes: bytes.length }
  },
}

export async function uploadFile(opts: UploadOptions, deps: UploadDeps): Promise<unknown> {
  const { bytes, baseName, sizeBytes: statedSize } = await deps.readFile(opts.filePath)
  const sizeBytes = statedSize ?? bytes.length
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`ファイルが 50MB を超えているためアップロードできません（${sizeBytes} バイト）`)
  }
  if (sizeBytes < 1) {
    throw new Error('空のファイルはアップロードできません')
  }

  const name = opts.name ?? baseName
  const mimeType = opts.mimeType ?? guessMimeType(name)

  // 1. 署名URL
  const urlResult = (await deps.callTool(opts.tool, { spaceId: opts.spaceId, name, mimeType, sizeBytes })) as UploadUrlResult
  if (!urlResult?.signedUrl || !urlResult.fileId) {
    throw new Error('サーバーからアップロード用URLを取得できませんでした')
  }

  // 2. 実バイトを PUT（Supabase Storage の署名アップロードURL。JS クライアントの uploadToSignedUrl と同じ）
  const put = await deps.fetch(urlResult.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType, 'x-upsert': 'false' },
    body: new Uint8Array(bytes),
  })
  if (!put.ok) {
    const body = await put.text().catch(() => '')
    throw new Error(`アップロードに失敗しました（HTTP ${put.status}）${body ? `: ${body.slice(0, 200)}` : ''}`)
  }

  // 3. 完了。ここで落ちると Storage に実体・DB に pending 行が残るので、やり直せるよう fileId を出す
  try {
    return await deps.callTool(opts.completeTool, { spaceId: opts.spaceId, fileId: urlResult.fileId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`アップロードは届きましたが完了処理に失敗しました（fileId: ${urlResult.fileId}）: ${msg}`)
  }
}
