'use client'

import { useQuery } from '@tanstack/react-query'
import { decodeTextBuffer, type TextEncodingName } from '@/lib/table/decodeText'
import { parseDelimited, detectDelimiter, type Delimiter, type TableData } from '@/lib/table/parseDelimited'
import { MAX_TABLE_FILE_LABEL } from '@/lib/table/tableModel'

export interface FileTableResult {
  table: TableData
  encoding: TextEncodingName
  /**
   * 直した表を保存(PUT)するときの基準になる版(files.updated_at)。中身と同じ応答から
   * 取るので、「読んだ中身」と「基準の版」がずれない。返ってこなかったときは null で、
   * 保存の前に読み直す合図になる。
   */
  updatedAt: string | null
  /** 元の区切り文字。書き戻すとき、TSV を CSV に変えてしまわないために覚えておく */
  delimiter: Delimiter
}

export const fileTableQueryKey = (fileId: string) => ['fileTable', fileId] as const

/**
 * ファイル(.csv/.tsv)の中身を取得し、表データに変換する。
 * - 取得は /api/files/[id]/content(RLS 経由・上限あり)
 * - 文字コード判定と表への変換はブラウザ側で行う(サーバーは生バイトを返すだけ)
 * - 表の編集で同じ id のまま中身が変わるようになったが、自分の保存はキャッシュを
 *   その場で差し替える(useSaveFileTable)ので、取り直しの間隔は長めのままでよい。
 *   ほかの人の編集は、保存時の版の確認(409)で気づける
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
      // 区切りは一度だけ判定し、表への変換と保存の両方で同じものを使う
      const delimiter = detectDelimiter(text)
      return {
        table: parseDelimited(text, { delimiter }),
        encoding,
        updatedAt: res.headers?.get('x-updated-at') ?? null,
        delimiter,
      }
    },
    enabled: !!fileId,
    staleTime: 10 * 60_000,
    // 変換済みの表は数MB の CSV で 100MB 級のメモリになる。既定(24時間)は長すぎるので
    // 画面を離れて 5 分で捨てる(再取得は速い)
    gcTime: 5 * 60_000,
    retry: false,
  })
}
