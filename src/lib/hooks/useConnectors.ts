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

// ---- ここから: 取り込み(inbound)マッピングウィザードが要るフック群 ----
// (Notion取り込みパネル NotionImportPanel.tsx から使う。provider非依存のcontainers一覧は
// 将来の他ツール(Backlog等)の取り込みウィザードでも再利用できるようにここへ置く)

/** 取り込み対象に選べる入れ物（Notion=データベース、Backlog=プロジェクト等。provider非依存）。 */
export interface ConnectorContainer {
  id: string
  title: string
}

interface ContainersResponse {
  containers: ConnectorContainer[]
  selected_container_ids: string[]
}

function containersQueryKey(orgId: string, connectionId: string) {
  return ['connectorContainers', orgId, connectionId] as const
}

/**
 * 接続の取り込み対象に選べる入れ物一覧
 * （GET /api/integrations/connections/[id]/containers?org_id=）。owner/admin以外も閲覧可
 * （APIがrequireOrgAdminを課しているため実質owner/adminのみ200になる。呼び出し側は
 * `enabled` に canManage を渡し、非管理者では実際にfetchしない — 実環境で403になる呼び出しを
 * 未然に避ける。認可の唯一の境界はAPI側のrequireOrgAdminであり、ここでの enabled はUX上の
 * 配慮に過ぎない）。
 *
 * ⚠ staleTime を5分にする(内部APIの安い読み取りから流用した15秒のままだと、パネル再マウントや
 * タブ復帰(グローバルのrefetchOnWindowFocus:true)のたびにNotionの/v1/search全ページ往復
 * (containers一覧の実体)が再実行され、体感速度が悪化する)。
 *
 * ⚠ selected_container_ids はUIの真実源にしない(初期表示の補助にとどめる)。「取り込み中/未設定」
 * バッジの判定は呼び出し側(NotionImportPanel)が connection.importConfig.read_container_ids
 * (useConnectorsのキャッシュ・楽観更新済み)から導出する。containers一覧を真実源にすると
 * 「取り込みをやめる」操作(read_container_idsを書き換えるだけ)の反映にcontainers再取得
 * (Notion往復)を挟む必要が生まれ、①解除してもバッジが古いまま残る ②バッジ更新のためだけに
 * 高コストな外部往復が走る、の2つの問題を招く。真実源を1つ(connectorConnectionsキャッシュ)に
 * 揃えることでどちらも解消する。
 */
export function useConnectionContainers(orgId: string, connectionId: string | null, enabled: boolean = true) {
  const queryKey = useMemo(() => containersQueryKey(orgId, connectionId ?? ''), [orgId, connectionId])

  const { data, isLoading, error, refetch } = useQuery<ContainersResponse>({
    queryKey,
    queryFn: async (): Promise<ContainersResponse> => {
      const response = await fetch(
        `/api/integrations/connections/${connectionId}/containers?org_id=${encodeURIComponent(orgId)}`,
      )
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '取り込み対象の一覧取得に失敗しました')
      return json as ContainersResponse
    },
    enabled: !!orgId && !!connectionId && enabled,
    staleTime: 5 * 60_000,
  })

  return {
    containers: data?.containers ?? [],
    selectedContainerIds: data?.selected_container_ids ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  }
}

/** status サブオブジェクトの入出力形（src/lib/task-sync/providers/notion/mapping.ts の型と同じ形）。 */
export interface NotionStatusMappingInput {
  prop_id: string
  prop_type: 'status' | 'select' | 'checkbox'
  done_option_ids: string[]
  write_done_option_id: string | null
}

/** 保存前（confirmed_at を持たない）のマッピング候補・確定候補の共通形。 */
export interface NotionMappingCandidate {
  due_prop_id: string | null
  status: NotionStatusMappingInput | null
}

export interface NotionSchemaPropertyOption {
  id: string
  name: string
}

export interface NotionSchemaProperty {
  id: string
  name: string
  type: string
  options?: NotionSchemaPropertyOption[]
}

export type NotionSchema = NotionSchemaProperty[]

export interface ProposeNotionMappingInput {
  orgId: string
  connectionId: string
  databaseId: string
}

export type NotionProposalSource = 'ai' | 'heuristic'
export type NotionAiUnavailableReason = 'ai_unconfigured' | 'llm_error' | 'invalid_response'

export interface ProposeNotionMappingResult {
  schema: NotionSchema
  proposal: NotionMappingCandidate
  proposalSource: NotionProposalSource
  /** AIによる精緻化が使えなかった理由。あるとき＝ヒューリスティックへフォールバックした。 */
  aiUnavailableReason?: NotionAiUnavailableReason
}

export interface UseNotionMappingProposalInput extends ProposeNotionMappingInput {
  /** 行を展開している間だけtrueにする(エディタが閉じている間はfetchしない)。 */
  enabled: boolean
}

function notionMappingProposalQueryKey(orgId: string, connectionId: string, databaseId: string) {
  return ['notionMappingProposal', orgId, connectionId, databaseId] as const
}

/**
 * Notionマッピング提案の取得（POST /api/integrations/connections/notion/mapping/propose）。
 * 「1回確認して確定する」ウィザードの入口。副作用（保存）は起こさないGET的操作のためuseQuery化
 * する。
 *
 * ⚠ 以前はuseMutation+useEffectで「マウント時に1回だけ呼ぶ」実装だったが、これだと
 *   ①エディタの開閉(=行の展開/折りたたみ)のたびに毎回LLMを呼び直す(同一(connection,database)の
 *     結果を使い回せず、確認のために開閉するだけで課金が漏れる)
 *   ②Next.jsのreactStrictMode(dev既定true)はeffectを2回実行するため、「設定する」1回につき
 *     Notionスキーマ取得+LLM呼び出しが2回走る(cancelledフラグはsetStateを抑えるだけでリクエスト
 *     自体は止まらない)
 * という2つの問題があった。useQueryはqueryKeyでin-flightをdedupeし、staleTime内の再マウントは
 * 再フェッチしないため、両方を解消する。
 *
 * ⚠ retry: 0 は必須。QueryProvider既定のretry(1)を継ぐと、失敗時にLLMが2回課金される。
 * ⚠ refetchOnWindowFocus: false。タブ復帰のたびに提案(LLM)を叩き直さない。
 * ⚠ refetchOnReconnect: false。既定(v5はtrue)のままだと、エディタを開いたままstaleTime(5分)を
 * 超えてネットワークが一瞬切れて復帰しただけでproposeが自動再実行され、①LLMが再課金される
 * ②このクエリの結果はuseEffectでフォームへ書き戻すため、利用者が選択中の値が黙って
 * 上書きされる、という二重の実害がある。
 * ⚠ staleTime を長め(5分)にする: 保存API(notion/mapping route)がライブスキーマへ再検証してから
 * 保存するため、提案キャッシュが多少古くても静かに壊れることはない(型不一致等は理由付きで400
 * になるだけ)。
 * ⚠ AbortSignalをqueryFnに渡す。エディタを閉じて(enabled:falseになって)クエリが不要になったら
 * react-queryが進行中のfetchを中断する。
 */
export function useNotionMappingProposal({
  orgId,
  connectionId,
  databaseId,
  enabled,
}: UseNotionMappingProposalInput) {
  const queryKey = useMemo(
    () => notionMappingProposalQueryKey(orgId, connectionId, databaseId),
    [orgId, connectionId, databaseId],
  )

  const { data, isLoading, error } = useQuery<ProposeNotionMappingResult>({
    queryKey,
    queryFn: async ({ signal }): Promise<ProposeNotionMappingResult> => {
      const response = await fetch('/api/integrations/connections/notion/mapping/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          connection_id: connectionId,
          database_id: databaseId,
        }),
        signal,
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'マッピング案の取得に失敗しました')
      return {
        schema: json.schema,
        proposal: json.proposal,
        proposalSource: json.proposal_source,
        aiUnavailableReason: json.ai_unavailable_reason,
      }
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    data,
    isLoading,
    error: error instanceof Error ? error.message : null,
  }
}

// ---- ここから: kintone アプリの追加・削除（KintoneConnectPanel.tsx / KintoneAppsPanel.tsx から使う） ----

export interface AddKintoneAppInput {
  orgId: string
  connectionId: string
  appId: string
  apiToken: string
}

export interface AddKintoneAppResult {
  appIds: string[]
}

/**
 * kintoneアプリの追加（POST /api/integrations/connections/kintone/apps）。owner/adminのみ。
 * サーバ側が新しいトークンで疎通確認してから保存する（間違ったトークンを保存させない）。
 *
 * ⚠ 判断（実装ランナーへの委任事項への回答。理由を明記のうえ実装する）:
 * 成功したら接続一覧(kintone_app_ids)だけを無効化し、containers一覧(listContainers。最大9
 * アプリぶんの直列外部往復)は無効化しない。route.ts が追加時に呼ぶ fetchAppFields はフィールド
 * 定義(schema)を返すだけでアプリ名を持たないため、レスポンスへ名前を含めるには kintone 側への
 * 別API往復を新たに追加する必要があり、それは「往復を減らす」目的と矛盾する。
 * KintoneAppsPanel.tsx の修正（登録済みアプリ一覧の正本を kintone_app_ids にし、containers
 * 一覧はタイトル解決だけの補助情報にする）により、追加直後は新しいアプリだけ生の app_id で
 * 表示され（表示が壊れることはない）、手動の「再読み込み」を押せばタイトルへ更新される。
 */
export function useAddKintoneApp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddKintoneAppInput): Promise<AddKintoneAppResult> => {
      const response = await fetch('/api/integrations/connections/kintone/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: input.orgId,
          connection_id: input.connectionId,
          app_id: input.appId,
          api_token: input.apiToken,
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'アプリの追加に失敗しました')
      return { appIds: json.app_ids }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export interface RemoveKintoneAppInput {
  orgId: string
  connectionId: string
  appId: string
}

export interface RemoveKintoneAppResult {
  appIds: string[]
}

/**
 * kintoneアプリの削除（DELETE /api/integrations/connections/kintone/apps）。owner/adminのみ。
 * `kintone_mappings[app_id]` は削除しない(Notionと同じ「確定済み設定は残す」挙動。サーバ側の
 * RPCコメント参照)。
 *
 * ⚠ containers一覧はinvalidateしない(表示速度是正)。削除は集合からの純粋な引き算であり、
 * 外部(kintone)から新しく取ってくる情報を何も必要としない。それにもかかわらずcontainers一覧
 * (listContainers。最大9アプリぶんの直列外部往復)をinvalidateすると、1件消すたびに残り全
 * アプリぶんの往復が走ってしまう。ここではcontainersキャッシュへsetQueryDataで直接
 * 引き算を反映し、外部往復ゼロで整合させる(containers一覧が一度も取得されていない=undefined
 * のときは何もしない。未取得の状態にキャッシュを新規作成すると、他所のisLoading判定などが
 * 崩れるため)。
 */
export function useRemoveKintoneApp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RemoveKintoneAppInput): Promise<RemoveKintoneAppResult> => {
      const response = await fetch('/api/integrations/connections/kintone/apps', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: input.orgId, connection_id: input.connectionId, app_id: input.appId }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'アプリの削除に失敗しました')
      return { appIds: json.app_ids }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
      queryClient.setQueryData<ContainersResponse>(
        containersQueryKey(input.orgId, input.connectionId),
        (old) => {
          if (!old) return old
          return { ...old, containers: old.containers.filter((c) => c.id !== input.appId) }
        },
      )
    },
  })
}

// ---- ここから: kintone マッピングウィザードが要るフック群（KintoneAppsPanel.tsx から使う） ----
// notion版(useNotionMappingProposal/useSaveNotionMapping)と同じ設計。kintoneはtitleも必須で
// 選ばせる点、選択肢は選択肢名(文字列)で対応づける点がNotionと異なる(サーバ側の型と揃える)。

/** status サブオブジェクトの入出力形（src/lib/task-sync/providers/kintone/mapping.ts の型と同じ形）。 */
export interface KintoneStatusMappingInput {
  field_code: string
  field_type: 'STATUS' | 'DROP_DOWN' | 'RADIO_BUTTON' | 'CHECK_BOX'
  done_values: string[]
  write_done_action: string | null
}

/** 保存前（confirmed_at を持たない）のマッピング候補・確定候補の共通形。 */
export interface KintoneMappingCandidate {
  title_field_code: string | null
  due_field_code: string | null
  status: KintoneStatusMappingInput | null
}

export interface KintoneSchemaField {
  code: string
  label: string
  type: string
  /** DROP_DOWN/RADIO_BUTTON/CHECK_BOXのときだけ選択肢名の配列を持つ。 */
  options?: string[]
}

export type KintoneSchema = KintoneSchemaField[]

export type KintoneProposalSource = 'ai' | 'heuristic'
export type KintoneAiUnavailableReason = 'ai_unconfigured' | 'llm_error' | 'invalid_response'

export interface ProposeKintoneMappingResult {
  schema: KintoneSchema
  proposal: KintoneMappingCandidate
  proposalSource: KintoneProposalSource
  aiUnavailableReason?: KintoneAiUnavailableReason
}

export interface UseKintoneMappingProposalInput {
  orgId: string
  connectionId: string
  appId: string
  /** 行を展開している間だけtrueにする(エディタが閉じている間はfetchしない)。 */
  enabled: boolean
}

function kintoneMappingProposalQueryKey(orgId: string, connectionId: string, appId: string) {
  return ['kintoneMappingProposal', orgId, connectionId, appId] as const
}

/**
 * kintoneマッピング提案の取得（POST /api/integrations/connections/kintone/mapping/propose）。
 * 「1回確認して確定する」ウィザードの入口。useNotionMappingProposalと同じ理由でuseQuery化する
 * (開閉のたびにLLMを呼び直さない・StrictModeの二重実行に耐える)。
 *
 * ⚠ retry: 0 は必須。QueryProvider既定のretry(1)を継ぐと、失敗時にLLMが2回課金される。
 * ⚠ refetchOnWindowFocus: false。タブ復帰のたびに提案(LLM)を叩き直さない。
 * ⚠ refetchOnReconnect: false。既定(v5はtrue)のままだと、エディタを開いたままstaleTime(5分)を
 * 超えてネットワークが一瞬切れて復帰しただけでproposeが自動再実行され、①LLMが再課金される
 * ②このクエリの結果はuseEffectでフォームへ書き戻すため、利用者が選択中の値が黙って
 * 上書きされる、という二重の実害がある(useNotionMappingProposalと同じ理由)。
 * ⚠ AbortSignalをqueryFnに渡す。エディタを閉じて(enabled:falseになって)クエリが不要になったら
 * react-queryが進行中のfetchを中断する。
 */
export function useKintoneMappingProposal({ orgId, connectionId, appId, enabled }: UseKintoneMappingProposalInput) {
  const queryKey = useMemo(
    () => kintoneMappingProposalQueryKey(orgId, connectionId, appId),
    [orgId, connectionId, appId],
  )

  const { data, isLoading, error } = useQuery<ProposeKintoneMappingResult>({
    queryKey,
    queryFn: async ({ signal }): Promise<ProposeKintoneMappingResult> => {
      const response = await fetch('/api/integrations/connections/kintone/mapping/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, connection_id: connectionId, app_id: appId }),
        signal,
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'マッピング案の取得に失敗しました')
      return {
        schema: json.schema,
        proposal: json.proposal,
        proposalSource: json.proposal_source,
        aiUnavailableReason: json.ai_unavailable_reason,
      }
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    data,
    isLoading,
    error: error instanceof Error ? error.message : null,
  }
}

export interface SaveKintoneMappingInput {
  orgId: string
  connectionId: string
  appId: string
  mapping: KintoneMappingCandidate
}

export interface SaveKintoneMappingResult {
  appId: string
  mapping: KintoneMappingCandidate & { confirmed_at: string }
}

/**
 * kintoneマッピングの確認・確定保存（PUT /api/integrations/connections/kintone/mapping）。
 * owner/adminのみ。成功したら接続一覧(import_config)だけを無効化する。
 *
 * ⚠ containers一覧はここで無効化しない(useSaveNotionMappingと同じ理由)。保存APIは
 * kintone_app_ids(＝登録済みアプリの集合)を一切変更しないため、containers一覧(listContainers。
 * 高コストな外部往復)を再取得する必要が無い。「設定済み/未設定」バッジは
 * connection.importConfig.kintone_mappings(上でinvalidateしたconnectorConnections)から
 * 導出する(バッジの真実源を二重化しない。KintoneAppsPanel.tsxのコメント参照)。
 */
export function useSaveKintoneMapping() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveKintoneMappingInput): Promise<SaveKintoneMappingResult> => {
      const response = await fetch('/api/integrations/connections/kintone/mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: input.orgId,
          connection_id: input.connectionId,
          app_id: input.appId,
          mapping: input.mapping,
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'マッピングの保存に失敗しました')
      return { appId: json.app_id, mapping: json.mapping }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}

export interface SaveNotionMappingInput {
  orgId: string
  connectionId: string
  databaseId: string
  mapping: NotionMappingCandidate
}

export interface SaveNotionMappingResult {
  databaseId: string
  mapping: NotionMappingCandidate & { confirmed_at: string }
}

/**
 * Notionマッピングの確認・確定保存（PUT /api/integrations/connections/notion/mapping）。owner/admin
 * のみ。サーバ側がライブスキーマ再取得での検証を経て保存し、read_container_idsにdatabase_idを
 * 追加する（src/app/api/integrations/connections/notion/mapping/route.ts参照）。
 *
 * 成功したら接続一覧(import_config。安い内部API読み取り)だけを無効化する。
 *
 * ⚠ containers一覧はここで無効化しない(以前はしていた)。「取り込み中/未設定」バッジは
 * connection.importConfig.read_container_ids(=connectorsQueryKeyのキャッシュ、上のinvalidateで
 * 更新される)から導出する設計にしたため、containers再取得は不要になった
 * (useConnectionContainersのコメント参照)。containers一覧を無効化すると、バッジを1つ更新したい
 * だけの操作でNotionの/v1/search全ページ往復(数百ms〜数秒)が毎回走ってしまう。
 */
export function useSaveNotionMapping() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveNotionMappingInput): Promise<SaveNotionMappingResult> => {
      const response = await fetch('/api/integrations/connections/notion/mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: input.orgId,
          connection_id: input.connectionId,
          database_id: input.databaseId,
          mapping: input.mapping,
        }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'マッピングの保存に失敗しました')
      return { databaseId: json.database_id, mapping: json.mapping }
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(input.orgId) })
    },
  })
}
