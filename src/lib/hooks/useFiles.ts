'use client'

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, useIsRestoring } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { ServerFileQuery } from '@/lib/files/filters'

export interface ProjectFile {
  id: string
  name: string
  /** 一覧に出す短い説明。未設定なら null */
  description: string | null
  mimeType: string
  sizeBytes: number
  origin: 'internal' | 'client'
  clientVisible: boolean
  uploadedBy: string
  uploaderName: string
  createdAt: string
}

interface FilesPage {
  files: ProjectFile[]
  /** 上限を超える件数が該当した(＝表示しきれていない) */
  hasMore: boolean
}

/**
 * data の形を ProjectFile[] から { files, hasMore } に変えたので、古い形の永続キャッシュが
 * そのまま流し込まれないようキーを版数化する(QueryProvider の PERSIST_BUSTER と同じ理由。
 * 全ページのキャッシュを捨てるほどの変更ではないので、キー側で回収する)。
 */
const FILES_QUERY_VERSION = 'v2'

/**
 * 検索条件つきのときは 'search' 枝に分ける。
 * - 検索するたびに全件のキャッシュを壊さない
 * - 検索結果だけ IDB に永続させない・短命にする、といった扱いを分けられる
 *   (QueryProvider の shouldDehydrateQuery がこの枝を見ている)
 */
export function filesQueryKey(spaceId: string | undefined, query?: ServerFileQuery) {
  return query && Object.keys(query).length > 0
    ? (['files', spaceId, FILES_QUERY_VERSION, 'search', query] as const)
    : (['files', spaceId, FILES_QUERY_VERSION] as const)
}

/**
 * 一覧の更新(楽観更新・保存後の反映)が当てる範囲。全件と検索結果の両方に当てる。
 * 版数を必ず含めること。含めないと前バージョンの永続キャッシュ(配列形状)まで前方一致で
 * 掴んでしまい、updater が undefined.map で落ちて「画面は変わったのに保存されない」になる。
 */
function filesQueryScope(spaceId: string) {
  return { queryKey: ['files', spaceId, FILES_QUERY_VERSION] as const }
}

/** 前バージョンの形(配列)で残っている永続キャッシュ。読まずに捨てる */
const LEGACY_FILES_KEY = (spaceId: string) => ['files', spaceId] as const

/**
 * キャッシュ上の1件だけを差し替える。
 * 形が違うもの(前バージョンの配列形状など)には触らずそのまま返す。
 */
function patchFileInPage(
  current: FilesPage | undefined,
  fileId: string,
  patch: Partial<ProjectFile>
): FilesPage | undefined {
  if (!current || !Array.isArray(current.files)) return current
  return {
    ...current,
    files: current.files.map((file) => (file.id === fileId ? { ...file, ...patch } : file)),
  }
}

function toSearchParams(spaceId: string, query: ServerFileQuery): string {
  const params = new URLSearchParams({ spaceId })
  if (query.q) params.set('q', query.q)
  if (query.kind) params.set('kind', query.kind)
  if (query.visibility) params.set('visibility', query.visibility)
  if (query.origin) params.set('origin', query.origin)
  return params.toString()
}

async function fetchFiles(spaceId: string, query: ServerFileQuery): Promise<FilesPage> {
  const res = await fetch(`/api/files?${toSearchParams(spaceId, query)}`)
  if (!res.ok) throw new Error('Failed to fetch files')
  const data = await res.json()
  return { files: data.files as ProjectFile[], hasMore: !!data.hasMore }
}

/**
 * スペースの公開済みファイル一覧を取得(新しい順・上限あり)
 */
export function useFiles(spaceId: string | undefined) {
  const queryClient = useQueryClient()
  const isRestoring = useIsRestoring()

  const query = useQuery({
    queryKey: filesQueryKey(spaceId),
    queryFn: () => fetchFiles(spaceId!, {}),
    enabled: !!spaceId,
  })

  // 前バージョンの形で残っている永続キャッシュを捨てる。放っておくと訪問のたびに
  // 復元・再永続されて消えず、IDB を圧迫し続ける。
  // 復元は非同期で、子の mount effect のほうが先に走る。isRestoring を待たずに消すと
  // 「消す → そのあと復元で復活」になって空振りする
  useEffect(() => {
    if (!spaceId || isRestoring) return
    queryClient.removeQueries({ queryKey: LEGACY_FILES_KEY(spaceId), exact: true })
  }, [queryClient, spaceId, isRestoring])

  return {
    data: query.data?.files,
    /** 上限を超えるファイルがある＝一覧に出ていない古いファイルがある */
    hasMore: query.data?.hasMore ?? false,
    error: query.error,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    /**
     * react-query の isLoading は「未取得 かつ 通信中」。IDB からキャッシュを戻している
     * 最中は通信していないので false になり、実際はファイルがあるのに一瞬
     * 「ファイルはまだありません」が出る。useTasks と同じ isPending && !data で判定する。
     * spaceId 未指定のときは取得自体しないので、読み込み中にはしない。
     */
    isLoading: !!spaceId && query.isPending && !query.data,
  }
}

/**
 * 上限を超えるスペース向けの、サーバー側での絞り込み。
 * 一覧に載っていない古いファイルも探せるようにするためのもので、
 * 上限内に収まっているスペースでは呼ばない(手元で絞るほうが速い)。
 */
export function useFileSearch(
  spaceId: string | undefined,
  query: ServerFileQuery,
  { enabled }: { enabled: boolean }
) {
  const result = useQuery({
    queryKey: filesQueryKey(spaceId, query),
    queryFn: () => fetchFiles(spaceId!, query),
    enabled: !!spaceId && enabled,
    // 打ち直しのたびに空欄へ戻らないよう、前の結果を出したまま裏で取り直す
    placeholderData: (previous) => previous,
    // 打鍵の切れ目ごとに別キーが生まれるので、使い終わったら早めに捨てる
    gcTime: 5 * 60 * 1000,
  })

  return {
    data: result.data?.files,
    /** 該当が多すぎて出しきれていない */
    hasMore: result.data?.hasMore ?? false,
    /**
     * まだ「前の結果」を出している状態。この間の hasMore は全件一覧のものなので、
     * そのまま「多すぎます」を出すと検索のたびに必ず一瞬点滅する
     */
    isPlaceholderData: result.isPlaceholderData,
    isFetching: result.isFetching,
    isError: result.isError,
  }
}

interface UploadFileParams {
  spaceId: string
  file: File
}

/**
 * ファイルをアップロード:
 * 1. 署名アップロードURLを発行
 * 2. そのURLへ実バイトをPUT
 * 3. アップロード完了をAPIに通知(status='ready'化 + 通知)
 */
export function useUploadFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ spaceId, file }: UploadFileParams) => {
      const urlRes = await fetch('/api/files/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })

      if (!urlRes.ok) {
        const error = await urlRes.json()
        throw new Error(error.error || 'Failed to create upload URL')
      }

      const { fileId, token, path } = await urlRes.json()

      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('space-files')
        .uploadToSignedUrl(path, token, file)

      if (uploadError) {
        throw new Error(uploadError.message || 'Failed to upload file')
      }

      const completeRes = await fetch(`/api/files/${fileId}/complete`, { method: 'POST' })
      if (!completeRes.ok) {
        const error = await completeRes.json()
        throw new Error(error.error || 'Failed to complete upload')
      }

      return completeRes.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries(filesQueryScope(variables.spaceId))
    },
  })
}

interface UpdateFileParams {
  spaceId: string
  fileId: string
  clientVisible?: boolean
  name?: string
  /** null を渡すと説明を消す。undefined は「触らない」 */
  description?: string | null
}

/**
 * ファイルの公開トグル・リネーム・説明文の更新
 */
export function useUpdateFile() {
  const queryClient = useQueryClient()

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: async ({ spaceId, fileId, clientVisible, name, description }: UpdateFileParams) => {
      const res = await fetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientVisible, name, description }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to update file')
      }

      return res.json()
    },
    // 保存ボタンを置かない方針なので、押した瞬間に一覧へ反映し、失敗したときだけ元に戻す。
    // 全件と検索結果でキャッシュが分かれているので、両方まとめて直す
    onMutate: async (variables) => {
      const scope = filesQueryScope(variables.spaceId)
      await queryClient.cancelQueries(scope)
      const previous = queryClient.getQueriesData<FilesPage>(scope)

      queryClient.setQueriesData<FilesPage>(scope, (current) =>
        patchFileInPage(current, variables.fileId, {
          ...(variables.clientVisible !== undefined ? { clientVisible: variables.clientVisible } : {}),
          ...(variables.name !== undefined ? { name: variables.name } : {}),
          ...(variables.description !== undefined ? { description: variables.description } : {}),
        })
      )

      return { previous }
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, data] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, data)
      }
    },
    // サーバーが返した確定値でその行だけ直す。ここで invalidate すると保存のたびに
    // 一覧を全件取り直すことになり、連続で押したときに後の楽観更新を上書きしてちらつく
    onSuccess: (result, variables) => {
      const updated = (result as { file?: { name?: string; description?: string | null; client_visible?: boolean } })?.file
      if (!updated) return

      queryClient.setQueriesData<FilesPage>(filesQueryScope(variables.spaceId), (current) =>
        patchFileInPage(current, variables.fileId, {
          ...(updated.name !== undefined ? { name: updated.name } : {}),
          ...(updated.description !== undefined ? { description: updated.description } : {}),
          ...(updated.client_visible !== undefined ? { clientVisible: updated.client_visible } : {}),
        })
      )
    },
  })
}

interface DeleteFileParams {
  spaceId: string
  fileId: string
}

/**
 * ファイルを削除
 */
export function useDeleteFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ fileId }: DeleteFileParams) => {
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to delete file')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries(filesQueryScope(variables.spaceId))
    },
  })
}

export { formatFileSize } from '@/lib/files/format'
