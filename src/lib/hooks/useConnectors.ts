'use client'

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { IntegrationId } from '@/lib/integrations/registry'

/**
 * 双方向同期コネクタ(multica / google_tasks / backlog等のタスク同期アダプタ実装済みツール)の
 * 接続一覧・作成・鍵ローテ・import_config更新フック。
 * docs/spec/MULTICA_CONNECTOR_CONTRACT.md（対外契約）/ useSinks.ts と同型。
 *
 * GET /api/integrations/connections は connectorProviders()（アダプタ登録表から導出、
 * src/app/api/integrations/connections/route.ts）が返す provider の接続を返し、secretは
 * 一切含めない。作成(POST multica / POST task-sync)・ローテ(POST multica/[id]/rotate)は
 * 平文secret/apiKeyを一度だけ受け渡す(呼び出し側が一度だけ表示・破棄)。import_configの更新は
 * 保存ボタンを持たず、呼び出し側のフォーム操作(選択・blur)から即時にmutateするoptimistic update
 * (useUpdateSinkと同型: 楽観反映→レスポンスで確定→失敗はロールバック)。
 */

/**
 * DBの provider 列自体は形式チェックのみ(src/lib/task-sync/adapters.ts のコメント参照)だが、
 * 値の妥当性の真実源はTS側の登録表(registry.ts の IntegrationId)にあるため、こちらもそれに
 * 揃える(素の string にすると「registryに無い値も受け付ける」ように見えてしまうため)。
 */
export type ConnectorProvider = IntegrationId
export type ConnectorViewerRole = 'owner' | 'admin' | 'member'

/** import_config の形状(契約: MULTICA_CONNECTOR_CONTRACT.md §「import 先の space/assignee 決定則」) */
export interface ConnectorImportConfig {
  target_space_id?: string
  read_list_ids?: string[]
  default_assignee_id?: string
}

export interface ConnectorConnection {
  id: string
  provider: ConnectorProvider
  status: string
  baseUrl: string | null
  /** 受信口の呼び名（generic_inbound のみ・任意設定なのでnullがありうる）。他providerは常にnull。 */
  label: string | null
  importEnabled: boolean
  importConfig: Record<string, unknown>
  createdAt: string | null
}

interface ConnectorsResponse {
  connections: ConnectorConnection[]
  viewerRole: ConnectorViewerRole | null
}

function connectorsQueryKey(orgId: string) {
  return ['connectorConnections', orgId] as const
}

/** org の双方向同期接続一覧＋viewerRole（GET /api/integrations/connections?orgId=） */
export function useConnectors(orgId: string) {
  const queryKey = useMemo(() => connectorsQueryKey(orgId), [orgId])

  const { data, isLoading, error, refetch } = useQuery<ConnectorsResponse>({
    queryKey,
    queryFn: async (): Promise<ConnectorsResponse> => {
      const response = await fetch(`/api/integrations/connections?orgId=${encodeURIComponent(orgId)}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '接続一覧の取得に失敗しました')
      return json as ConnectorsResponse
    },
    enabled: !!orgId,
    staleTime: 15_000,
  })

  return {
    connections: data?.connections ?? [],
    viewerRole: data?.viewerRole ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  }
}

export interface CreateMulticaConnectionInput {
  orgId: string
  baseUrl: string
}

export interface CreateMulticaConnectionResult {
  connectionId: string
  baseUrl: string
  webhookUrl: string
  sendSecret: string
  receiveSecret: string
}

/**
 * multica接続の作成（POST /api/integrations/connections/multica）。owner/adminのみ(APIが担保)。
 * send/receiveの平文secretを一度だけ返す。成功で一覧を無効化する(secretはキャッシュに保存しない)。
 */
export function useCreateMulticaConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateMulticaConnectionInput): Promise<CreateMulticaConnectionResult> => {
      const response = await fetch('/api/integrations/connections/multica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: input.orgId, base_url: input.baseUrl }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'multica接続の作成に失敗しました')
      return {
        connectionId: json.connection_id,
        baseUrl: json.base_url,
        webhookUrl: json.webhook_url,
        sendSecret: json.send_secret,
        receiveSecret: json.receive_secret,
      }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export interface CreateGenericInboundConnectionInput {
  orgId: string
  /** 呼び名(任意)。複数の送信元(Zapier経由のANDPAD等)を見分けるためだけに使う。 */
  label?: string
}

export interface CreateGenericInboundConnectionResult {
  connectionId: string
  webhookUrl: string
  /** 平文はこの応答でしか返らない(以後の取得経路なし)。呼び出し側が一度だけ表示・破棄する。 */
  receiveSecret: string
}

/**
 * 汎用Webhook受信口の作成（POST /api/integrations/connections/generic-inbound）。owner/adminのみ
 * (APIが担保)。multicaと違い相互鍵ではなく受信鍵1本だけを一度だけ返す(こちらから外部へは
 * 取りに行かない受信専用のため)。成功で一覧を無効化する(secretはキャッシュに保存しない)。
 */
export function useCreateGenericInboundConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: CreateGenericInboundConnectionInput,
    ): Promise<CreateGenericInboundConnectionResult> => {
      const response = await fetch('/api/integrations/connections/generic-inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: input.orgId, label: input.label }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '受信口の作成に失敗しました')
      return {
        connectionId: json.connection_id,
        webhookUrl: json.webhook_url,
        receiveSecret: json.receive_secret,
      }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export type ConnectorSecretDirection = 'send' | 'receive'

export interface RotateMulticaSecretInput {
  orgId: string
  connectionId: string
  direction: ConnectorSecretDirection
}

export interface RotateMulticaSecretResult {
  direction: ConnectorSecretDirection
  secret: string
}

/**
 * multica鍵のローテーション（POST /connections/multica/[id]/rotate?direction=send|receive）。
 * owner/adminのみ。平文secretを一度だけ返す。成功で一覧を無効化する。
 */
export function useRotateMulticaSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RotateMulticaSecretInput): Promise<RotateMulticaSecretResult> => {
      const response = await fetch(
        `/api/integrations/connections/multica/${input.connectionId}/rotate?direction=${input.direction}`,
        { method: 'POST' },
      )
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '鍵のローテーションに失敗しました')
      return json as RotateMulticaSecretResult
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export interface CreateTaskSyncConnectionInput {
  orgId: string
  provider: IntegrationId
  apiKey: string
  /** hostPolicy.kind==='fixed'のツールはURL不要('固定ホスト'なのでbase_urlを送らない)。 */
  baseUrl?: string
  /**
   * ツール固有の追加設定（例: Jira の Basic 認証に要る `jira_email`）。APIキーだけでは
   * 認証が成立しないツール専用の可視値（秘密はapiKeyの1本に集約する）。
   * サーバ側(sanitizeProviderConfig)がprovider接頭辞のキーだけを受理するので、キー名は
   * 呼び出し側(TaskSyncConnectPanel)が provider 名を接頭辞に付けて渡す。
   */
  providerConfig?: Record<string, unknown>
}

export interface CreateTaskSyncConnectionResult {
  connectionId: string
  provider: IntegrationId
}

/**
 * APIキー方式タスク同期接続の作成（POST /api/integrations/connections/task-sync）。owner/adminのみ
 * (APIが担保)。成功で一覧(connectorsQueryKey)を無効化する。gtasks/multicaと同じ接続一覧を共有する
 * ため、既存のqueryKeyへ相乗りさせている(専用のqueryKeyを持つとGET側のフィルタも専用にする必要が
 * 生まれ、二重管理になる)。
 */
export function useCreateTaskSyncConnection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateTaskSyncConnectionInput): Promise<CreateTaskSyncConnectionResult> => {
      const response = await fetch('/api/integrations/connections/task-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: input.orgId,
          provider: input.provider,
          api_key: input.apiKey,
          base_url: input.baseUrl,
          provider_config: input.providerConfig,
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '接続に失敗しました')
      return { connectionId: json.connection_id, provider: json.provider }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export interface UpdateImportConfigInput {
  orgId: string
  connectionId: string
  importConfig: Record<string, unknown>
  /**
   * 省略時はimport_enabledを変更しない(既存呼び出し元=multicaの取り込み先スペース選択は
   * import_enabledと無関係。multica inboundはwebhook駆動でimport_enabledを見ないため)。
   * 呼び出し側(ImportConfigEditor)が「取り込み先スペースが決まった=動かしてよい」の
   * 判断材料として渡す。
   */
  importEnabled?: boolean
}

export interface UpdateImportConfigResult {
  id: string
  importConfig: Record<string, unknown>
  importEnabled?: boolean
}

/**
 * import_configの更新（PATCH /api/integrations/connections/[id]/import-config）。owner/adminのみ。
 * 保存ボタンを持たないため、呼び出し側(select onChange / text onBlur)が都度呼ぶ前提で
 * optimistic updateする(useUpdateSinkと同型)。org境界検証はDBトリガー由来の422、
 * UUID形式不正は400としてAPIが返し、そのままerror.messageに載せる。
 *
 * import_enabledも同じPATCHに相乗りさせる(import_configとimport_enabledは同じ接続行の
 * カラムであり、2回に分けて呼ぶと片方だけ失敗した際に状態が中途半端になるため。API側の対応は
 * 別途依頼中)。
 */
export function useUpdateImportConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateImportConfigInput): Promise<UpdateImportConfigResult> => {
      const response = await fetch(`/api/integrations/connections/${input.connectionId}/import-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          import_config: input.importConfig,
          ...(input.importEnabled !== undefined ? { import_enabled: input.importEnabled } : {}),
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '取り込み設定の更新に失敗しました')
      return { id: json.id, importConfig: json.import_config, importEnabled: json.import_enabled }
    },
    onMutate: async (input) => {
      const queryKey = connectorsQueryKey(input.orgId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ConnectorsResponse>(queryKey)

      queryClient.setQueryData<ConnectorsResponse>(queryKey, (old) => {
        if (!old) return old
        return {
          ...old,
          connections: old.connections.map((connection) =>
            connection.id === input.connectionId
              ? {
                  ...connection,
                  importConfig: input.importConfig,
                  ...(input.importEnabled !== undefined ? { importEnabled: input.importEnabled } : {}),
                }
              : connection,
          ),
        }
      })

      return { previous, queryKey }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
    },
    onSuccess: (result, input) => {
      // useUpdateSink と同型: フィールド編集のたびに一覧をフル invalidate=再フェッチすると
      // 1操作ごとに GET /connections が走り(storm)、飛行中GETが他フィールドの楽観反映を
      // 一瞬上書きしてちらつく。サーバ応答を setQueryData で突き合わせて確定させる。
      const queryKey = connectorsQueryKey(input.orgId)
      queryClient.setQueryData<ConnectorsResponse>(queryKey, (old) => {
        if (!old) return old
        return {
          ...old,
          connections: old.connections.map((connection) =>
            connection.id === result.id
              ? {
                  ...connection,
                  importConfig: result.importConfig,
                  ...(result.importEnabled !== undefined ? { importEnabled: result.importEnabled } : {}),
                }
              : connection,
          ),
        }
      })
    },
  })
}
