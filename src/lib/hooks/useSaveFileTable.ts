'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Delimiter, TableData } from '@/lib/table/parseDelimited'
import { toCsvBytes } from '@/lib/table/serializeDelimited'
import { MAX_TABLE_FILE_LABEL } from '@/lib/table/tableModel'
import { fileTableQueryKey, type FileTableResult } from '@/lib/hooks/useFileTable'

/**
 * 直した表を、同じファイル(同じ id・同じ置き場所)へ書き戻す。
 *
 * - 送るのは BOM 付き UTF-8 のバイト列。区切りは元のファイルと同じものを使う
 * - 必ず「基準の版」を添える。ズレていればサーバーが 409 を返し、ここで競合として止める
 *   (黙って上書きしない)。呼び出し側は帯を出して、読み直すか書きかけを退避させる
 * - 保存できたら、表のキャッシュ(fileTable)をその場で差し替える。取り直しはしない
 */

/** 自分が読んだあとに、別の人(または別の画面)が保存していた。 */
export class FileTableConflictError extends Error {
  constructor(message = 'このファイルは、別の場所で更新されています') {
    super(message)
    this.name = 'FileTableConflictError'
  }
}

/**
 * 保存そのものは失敗したが、行の版だけは進んでしまった状態。同じ基準でやり直すと
 * 必ず 409 になるため、新しい版を持ち回してやり直せるようにする。
 */
export class FileTableSaveError extends Error {
  readonly updatedAt?: string
  constructor(message: string, updatedAt?: string) {
    super(message)
    this.name = 'FileTableSaveError'
    this.updatedAt = updatedAt
  }
}

export interface SaveFileTableParams {
  fileId: string
  spaceId: string
  table: TableData
  delimiter: Delimiter
  /** 直前に読んだ(または保存した)ときの版 */
  baseUpdatedAt: string
}

export interface SaveFileTableResult {
  /** 次の保存の基準になる、新しい版 */
  updatedAt: string
}

export function useSaveFileTable() {
  const queryClient = useQueryClient()

  const saveTable = useCallback(
    async ({ fileId, table, delimiter, baseUpdatedAt }: SaveFileTableParams): Promise<SaveFileTableResult> => {
      const bytes = toCsvBytes(table, delimiter)
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

      const res = await fetch(`/api/files/${fileId}/content`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Base-Updated-At': baseUpdatedAt,
        },
        body,
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string; updatedAt?: string }

        if (res.status === 409) throw new FileTableConflictError()
        if (res.status === 403) {
          throw new FileTableSaveError('このファイルを編集できる権限がありません')
        }
        if (res.status === 413) {
          throw new FileTableSaveError(
            `直した表が大きすぎて保存できません(上限${MAX_TABLE_FILE_LABEL})。行や列を減らしてください`
          )
        }
        if (res.status === 404) throw new FileTableSaveError('ファイルが見つかりません')
        throw new FileTableSaveError('表を保存できませんでした', payload.updatedAt)
      }

      const { updatedAt } = (await res.json()) as { updatedAt: string }

      // 保存できた中身と版でキャッシュを差し替える(取り直さない)。画面に出ているのは
      // すでにこの中身なので、ここで取り直すと同じものを取りに行くだけになる
      queryClient.setQueryData<FileTableResult>(fileTableQueryKey(fileId), (current) =>
        current ? { ...current, table, updatedAt } : current
      )

      return { updatedAt }
    },
    [queryClient]
  )

  return { saveTable }
}
