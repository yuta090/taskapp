'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

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

/**
 * スペースの公開済みファイル一覧を取得
 */
export function useFiles(spaceId: string | undefined) {
  const query = useQuery({
    queryKey: ['files', spaceId],
    queryFn: async () => {
      if (!spaceId) return []

      const res = await fetch(`/api/files?spaceId=${spaceId}`)
      if (!res.ok) throw new Error('Failed to fetch files')
      const data = await res.json()
      return data.files as ProjectFile[]
    },
    enabled: !!spaceId,
  })

  return {
    data: query.data,
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
      queryClient.invalidateQueries({ queryKey: ['files', variables.spaceId] })
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
    // 保存ボタンを置かない方針なので、押した瞬間に一覧へ反映し、失敗したときだけ元に戻す
    onMutate: async (variables) => {
      const queryKey = ['files', variables.spaceId]
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ProjectFile[]>(queryKey)

      queryClient.setQueryData<ProjectFile[]>(queryKey, (current) =>
        (current || []).map((file) =>
          file.id === variables.fileId
            ? {
                ...file,
                ...(variables.clientVisible !== undefined ? { clientVisible: variables.clientVisible } : {}),
                ...(variables.name !== undefined ? { name: variables.name } : {}),
                ...(variables.description !== undefined ? { description: variables.description } : {}),
              }
            : file
        )
      )

      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    // サーバーが返した確定値でその行だけ直す。ここで invalidate すると保存のたびに
    // 一覧を全件取り直すことになり、連続で押したときに後の楽観更新を上書きしてちらつく
    onSuccess: (result, variables) => {
      const updated = (result as { file?: { name?: string; description?: string | null; client_visible?: boolean } })?.file
      if (!updated) return

      queryClient.setQueryData<ProjectFile[]>(['files', variables.spaceId], (current) =>
        (current || []).map((file) =>
          file.id === variables.fileId
            ? {
                ...file,
                ...(updated.name !== undefined ? { name: updated.name } : {}),
                ...(updated.description !== undefined ? { description: updated.description } : {}),
                ...(updated.client_visible !== undefined ? { clientVisible: updated.client_visible } : {}),
              }
            : file
        )
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
      queryClient.invalidateQueries({ queryKey: ['files', variables.spaceId] })
    },
  })
}

export { formatFileSize } from '@/lib/files/format'
