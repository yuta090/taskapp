'use client'

import { useQuery } from '@tanstack/react-query'
import { decodeTextBuffer, type TextEncodingName } from '@/lib/table/decodeText'
import { parseDelimited, type TableData } from '@/lib/table/parseDelimited'
import { MAX_TABLE_FILE_LABEL } from '@/lib/table/tableModel'

export interface FileTableResult {
  table: TableData
  encoding: TextEncodingName
}

export const fileTableQueryKey = (fileId: string) => ['fileTable', fileId] as const

/**
 * ファイル(.csv/.tsv)の中身を取得し、表データに変換する。
 * - 取得は /api/files/[id]/content(RLS 経由・上限あり)
 * - 文字コード判定と表への変換はブラウザ側で行う(サーバーは生バイトを返すだけ)
 * - 同じファイル id の中身は変わらない(差し替えは別 id になる)ので長めに staleTime を取る
 * - 変換後の表はサイズが大きくなり得るため、永続キャッシュ(IDB)には載せない
 *   (QueryProvider.shouldDehydrateQuery で 'fileTable' を除外)
 */
export function useFileTable(fileId: string | undefined) {
  return useQuery<FileTableResult, Error>({
    queryKey: fileTableQueryKey(fileId ?? ''),
    queryFn: async () => {
      const res = await fetch(`/api/files/${fileId}/content`)
      if (!res.ok) {
        if (res.status === 413) throw new Error(`このファイルは大きすぎるため表として開けません(上限${MAX_TABLE_FILE_LABEL})。ダウンロードして開いてください`)
        if (res.status === 415) throw new Error('このファイルは表として開けない形式です(CSV / TSV のみ対応)')
        if (res.status === 404) throw new Error('ファイルが見つかりません')
        throw new Error('ファイルの読み込みに失敗しました')
      }
      const buffer = await res.arrayBuffer()
      const { text, encoding } = decodeTextBuffer(buffer)
      return { table: parseDelimited(text), encoding }
    },
    enabled: !!fileId,
    staleTime: 10 * 60_000,
    // 変換済みの表は数MB の CSV で 100MB 級のメモリになる。既定(24時間)は長すぎるので
    // 画面を離れて 5 分で捨てる(再取得は速い)
    gcTime: 5 * 60_000,
    retry: false,
  })
}
