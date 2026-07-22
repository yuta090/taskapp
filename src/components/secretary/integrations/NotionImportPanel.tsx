'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowsClockwise, CaretDown, CaretRight, CheckCircle } from '@phosphor-icons/react'
import {
  useConnectors,
  useConnectionContainers,
  useNotionMappingProposal,
  useSaveNotionMapping,
  useUpdateImportConfig,
  type ConnectorConnection,
  type ConnectorContainer,
  type NotionMappingCandidate,
  type NotionSchema,
  type NotionSchemaProperty,
  type NotionStatusMappingInput,
} from '@/lib/hooks/useConnectors'
import { useSinks } from '@/lib/hooks/useSinks'
import { normalizeImportConfigPatch } from '@/lib/integrations/importConfig'

interface NotionImportPanelProps {
  orgId: string
}

/**
 * Notion取り込み(inbound)パネル — Notionを「送りっぱなし通知(sink)」だけでなく「正本として
 * タスクを取り込み、完了を書き戻す」双方向同期(connector)としても使うための設定UI。
 *
 * 書き出し(SinkProviderPanel)とは別の関心事のため独立コンポーネントにする
 * (IntegrationsConsoleClientがNotion選択時にSinkProviderPanelと並べて描画する)。
 *
 * モーダル禁止。「マッピングの確定」だけは1回確認して確定する性質の操作なので明示ボタンにする
 * (この画面での唯一の例外。理由は NotionMappingEditor のコメント参照)。一覧の取り込みON/OFF
 * 切替は他の取り込み設定(ImportConfigEditor等)と同じくoptimistic update。
 * amberはクライアント可視要素専用のためここでは使わない(このコンソールは秘書内部専用画面で
 * クライアントは到達しない。ConnectorSyncPane.tsx等の既存コメントと同じ)。
 */
export function NotionImportPanel({ orgId }: NotionImportPanelProps) {
  const { notionConnection } = useSinks(orgId)
  const { connections, viewerRole, isLoading } = useConnectors(orgId)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'
  const connection = connections.find((c) => c.provider === 'notion') ?? null

  if (isLoading) {
    return (
      <section data-testid="notion-import-panel-skeleton" className="border-t border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-8 w-full max-w-sm bg-gray-100 rounded animate-pulse" />
      </section>
    )
  }

  // 接続そのもの(sinkの認証)はSinkProviderPanel/CreateSinkFormが担う。ここでは新規接続はさせず、
  // 既存の「Notionに接続」導線と同じ文言・リンク先を案内するだけにする(導線を二重実装しない)。
  if (!notionConnection.connected || !connection) {
    return (
      <section className="border-t border-gray-200 px-4 py-3 flex-shrink-0">
        <h3 className="text-xs font-semibold text-gray-900 mb-1">Notionからの取り込み</h3>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          先にNotionワークスペースへ接続してください。{' '}
          <a
            href={`/api/integrations/auth/notion?orgId=${encodeURIComponent(orgId)}`}
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            Notion に接続
          </a>
        </p>
      </section>
    )
  }

  return (
    <section className="border-t border-gray-200 px-4 py-3 flex-shrink-0 max-h-[50vh] overflow-y-auto">
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-gray-900">Notionからの取り込み</h3>
        <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
          データベースを選び、期日・完了の対応づけを1回確認してから取り込みを開始します(書き出しとは別の設定です)。
        </p>
      </div>
      <NotionDatabaseList orgId={orgId} connection={connection} canManage={canManage} />
    </section>
  )
}

interface NotionDatabaseListProps {
  orgId: string
  connection: ConnectorConnection
  canManage: boolean
}

/**
 * ⚠ Notion共有先が非常に多いワークスペースでは、Notionの`/v1/search`ページングを直列に辿る
 * containers一覧の初回取得に時間がかかることがある(既知の制約。件数上限/名前フィルタは今回未実装)。
 */
function NotionDatabaseList({ orgId, connection, canManage }: NotionDatabaseListProps) {
  // canManage=falseの間はfetch自体させない(useConnectionContainersのenabled引数)。実環境では
  // APIがrequireOrgAdminで403を返すだけなので、そもそも呼ばない方がUXも実装もシンプルになる
  // (認可の唯一の境界はAPI側のrequireOrgAdminであり、ここでの分岐はUXの配慮に過ぎない)。
  const { containers, isLoading, error, refetch } = useConnectionContainers(orgId, connection.id, canManage)
  const [editingId, setEditingId] = useState<string | null>(null)
  // 一覧レベルで1つだけ持つ(行ごとに独立したmutationにしない)。行ごとに持つと、2つの行を
  // 連続して解除したとき両方が「クリック時点のconnection.importConfigの全体」から配列を
  // 組み立て、後勝ちで片方が復活するlost updateが起きる(実際に起きていた罠)。ここでは
  // 実行中(isPending)は全行の「取り込みをやめる」ボタンを無効化して操作を直列化した上で、
  // 送信直前に最新のprops(connection.importConfig。親のuseConnectorsキャッシュに追従して
  // 常に最新)から配列を組み立てる。
  const updateImportConfig = useUpdateImportConfig()

  // 「保存中に別DBのエディタへ切り替える」を跨いでも、保存完了時に閉じるのは「保存した本人の
  // エディタが今も開いていれば」だけにする(container単位で判定。setEditingId(null)を直接
  // onSavedへ渡すと、切替後に開いている別DBのエディタまで閉じてしまう)。
  const closeEditorIfCurrent = (containerId: string) => {
    setEditingId((current) => (current === containerId ? null : current))
  }

  if (!canManage) {
    return <p className="text-[11px] text-gray-400">データベースの選択・設定はowner/adminのみ行えます。</p>
  }

  if (isLoading) {
    return <div className="h-8 w-full bg-gray-100 rounded animate-pulse" />
  }

  if (error) {
    return <p className="text-[11px] text-red-600">{error}</p>
  }

  if (containers.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-gray-400">
          取り込めるデータベースが見つかりません(Notion側でこの連携にデータベースを共有してください)。
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowsClockwise className="w-3 h-3" />
          再読み込み
        </button>
      </div>
    )
  }

  // 取り込み中/未設定の判定はcontainers一覧(selected_container_ids)ではなくconnection.importConfig
  // から導出する(useConnectionContainersのコメント参照。真実源を1つに揃える)。
  const readContainerIds = Array.isArray(connection.importConfig.read_container_ids)
    ? (connection.importConfig.read_container_ids as string[])
    : []

  /**
   * 取り込み対象から外す(read_container_idsからこのdatabase_idだけを除く)。軽い操作なので
   * optimistic update(useUpdateImportConfigが担う)。確認ダイアログは出さない
   * (モーダル禁止・このUIの操作は取り消し可能な設定変更であり、破壊的操作ではないため)。
   */
  const handleRemove = async (containerId: string) => {
    // normalizeImportConfigPatch は read_container_ids の空配列を値としてそのまま送る
    // (他キーの空文字/空配列は「未設定」を意味する null に変換される)。
    // ここで全解除(結果が空配列)になっても、その意図がサーバへ正しく伝わる。
    const nextConfig = normalizeImportConfigPatch({
      ...connection.importConfig,
      read_container_ids: readContainerIds.filter((id) => id !== containerId),
    })
    try {
      await updateImportConfig.mutateAsync({ orgId, connectionId: connection.id, importConfig: nextConfig })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取り込み対象の変更に失敗しました')
    }
  }

  return (
    <ul className="space-y-1.5">
      {containers.map((container) => (
        <NotionDatabaseRow
          key={container.id}
          orgId={orgId}
          connection={connection}
          container={container}
          canManage={canManage}
          isSelected={readContainerIds.includes(container.id)}
          isEditing={editingId === container.id}
          isRemoving={updateImportConfig.isPending}
          onStartEdit={() => setEditingId(container.id)}
          onStopEdit={() => closeEditorIfCurrent(container.id)}
          onRemove={() => void handleRemove(container.id)}
        />
      ))}
    </ul>
  )
}

interface NotionDatabaseRowProps {
  orgId: string
  connection: ConnectorConnection
  container: ConnectorContainer
  canManage: boolean
  isSelected: boolean
  isEditing: boolean
  /** 一覧のどこかで「取り込みをやめる」が実行中の間はtrue(全行を無効化して操作を直列化する)。 */
  isRemoving: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onRemove: () => void
}

function NotionDatabaseRow({
  orgId,
  connection,
  container,
  canManage,
  isSelected,
  isEditing,
  isRemoving,
  onStartEdit,
  onStopEdit,
  onRemove,
}: NotionDatabaseRowProps) {
  return (
    <li className="rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs text-gray-900 truncate flex-1">{container.title}</span>
        {isSelected ? (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-50 text-green-700 flex-shrink-0">
            <CheckCircle className="w-3 h-3" weight="fill" />
            取り込み中
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 flex-shrink-0">
            未設定
          </span>
        )}
        {canManage && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => (isEditing ? onStopEdit() : onStartEdit())}
              className="flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              {isEditing ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
              {isSelected ? '設定を変更' : '設定する'}
            </button>
            {isSelected && (
              <button
                type="button"
                onClick={onRemove}
                disabled={isRemoving}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                取り込みをやめる
              </button>
            )}
          </div>
        )}
      </div>
      {isEditing && canManage && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          <NotionMappingEditor
            orgId={orgId}
            connection={connection}
            container={container}
            onSaved={onStopEdit}
            onCancel={onStopEdit}
          />
        </div>
      )}
    </li>
  )
}

/** UIの選択欄で使う「未設定」を表す特別値(propが無い/選ばない = null)。空文字はNotionのprop_idと衝突しない。 */
const NONE_VALUE = ''

const STATUS_CAPABLE_TYPES = new Set(['status', 'select', 'checkbox'])

interface NotionMappingEditorProps {
  orgId: string
  connection: ConnectorConnection
  container: ConnectorContainer
  onSaved: () => void
  onCancel: () => void
}

/**
 * 期日・完了の対応づけを1回確認して確定するエディタ(「AI提案＋人が1回確認」方式)。
 *
 * ⚠ CLAUDE.mdの「保存ボタン無し(optimistic update)」の例外: このマッピング確定は
 * 「サーバ側がライブスキーマへ再検証してから保存する」一度きりの確認行為であり、間違った対応づけを
 * 即座反映すると取り込み開始後に誤ったプロパティへ書き戻しが起きかねない。他の一覧トグル(このパネルの
 * 取り込みON/OFF)とは性質が違うため、ここだけ明示的な「この設定で取り込む」ボタンにする。
 */
function NotionMappingEditor({ orgId, connection, container, onSaved, onCancel }: NotionMappingEditorProps) {
  // エディタは行の展開/折りたたみで都度マウント/アンマウントされる(NotionDatabaseRowが
  // 条件付きレンダリングする)。useQuery化しているので、同一(connection,database)を開き直しても
  // staleTime(5分)内はキャッシュを再利用し、提案API(LLM呼び出し)を叩き直さない
  // (useNotionMappingProposalのコメント参照。以前はuseMutation+useEffectで開閉のたびに
  // 必ず呼び直しており、確認のために開閉するだけで課金が漏れていた)。
  const proposal = useNotionMappingProposal({
    orgId,
    connectionId: connection.id,
    databaseId: container.id,
    enabled: true,
  })
  const save = useSaveNotionMapping()

  const [saveError, setSaveError] = useState<string | null>(null)

  const [dueId, setDueId] = useState<string>(NONE_VALUE)
  const [statusPropId, setStatusPropId] = useState<string>(NONE_VALUE)
  const [doneOptionIds, setDoneOptionIds] = useState<string[]>([])
  const [writeDoneOptionId, setWriteDoneOptionId] = useState<string>(NONE_VALUE)

  function applyCandidate(candidate: NotionMappingCandidate) {
    setDueId(candidate.due_prop_id ?? NONE_VALUE)
    setStatusPropId(candidate.status?.prop_id ?? NONE_VALUE)
    setDoneOptionIds(candidate.status?.done_option_ids ?? [])
    setWriteDoneOptionId(candidate.status?.write_done_option_id ?? NONE_VALUE)
  }

  // 提案の取得結果(data)が新しく来たときだけ、フォームへ初期値を反映する
  // (外部から届いたデータをフォームの初期値として反映する意図的なリセット。データ変更時のみ
  // 発火し、無限ループにはならない。PortalTaskInspectorの同種パターンと同じ)。
  const proposalData = proposal.data
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (proposalData) applyCandidate(proposalData.proposal)
  }, [proposalData])

  // 保存エラーは「保存APIの結果」を表す一過性の表示であり、利用者が対応づけを変更した時点で
  // 意味を失う(直したのに古いエラー文言が残り続けるのを防ぐ意図的なリセット)。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError(null)
  }, [dueId, statusPropId, doneOptionIds, writeDoneOptionId])

  if (proposal.error) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-red-600">{proposal.error}</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          閉じる
        </button>
      </div>
    )
  }

  if (!proposalData) {
    return <div className="h-16 w-full bg-gray-50 rounded animate-pulse" />
  }

  const schema: NotionSchema = proposalData.schema
  const proposalSource = proposalData.proposalSource
  const aiUnavailableReason = proposalData.aiUnavailableReason ?? null

  const dateProps = schema.filter((p) => p.type === 'date')
  const statusCapableProps = schema.filter((p) => STATUS_CAPABLE_TYPES.has(p.type))
  const selectedStatusProp: NotionSchemaProperty | undefined = statusCapableProps.find((p) => p.id === statusPropId)
  const statusOptions = selectedStatusProp?.options ?? []
  const isCheckbox = selectedStatusProp?.type === 'checkbox'

  const canSubmit =
    // status/selectを選んだのに完了とみなす選択肢が1件も無い設定は、保存APIが必ず400で
    // 弾く(mapping.tsの契約)。事前に弾いて無駄な往復を減らす(最終防衛線はサーバ側)。
    !selectedStatusProp || isCheckbox || doneOptionIds.length > 0

  const toggleDoneOption = (optionId: string) => {
    const wasChecked = doneOptionIds.includes(optionId)
    setDoneOptionIds((prev) => (wasChecked ? prev.filter((id) => id !== optionId) : [...prev, optionId]))
    // 書き戻し先として選んでいた選択肢を「完了とみなす」から外したら、書き戻し設定も一緒に外す
    // (書き戻した値が「完了」と読み取られなくなる=次回ポーリングでcompletedに戻ってしまう矛盾を防ぐ)。
    if (wasChecked && writeDoneOptionId === optionId) setWriteDoneOptionId(NONE_VALUE)
  }

  const handleStatusPropChange = (nextPropId: string) => {
    setStatusPropId(nextPropId)
    setDoneOptionIds([])
    setWriteDoneOptionId(NONE_VALUE)
  }

  const handleSubmit = async () => {
    setSaveError(null)
    const status: NotionStatusMappingInput | null = !selectedStatusProp
      ? null
      : {
          prop_id: selectedStatusProp.id,
          prop_type: selectedStatusProp.type as NotionStatusMappingInput['prop_type'],
          done_option_ids: isCheckbox ? [] : doneOptionIds,
          write_done_option_id: isCheckbox ? null : writeDoneOptionId || null,
        }
    const mapping: NotionMappingCandidate = { due_prop_id: dueId || null, status }

    try {
      await save.mutateAsync({ orgId, connectionId: connection.id, databaseId: container.id, mapping })
      onSaved()
    } catch (err) {
      // 保存APIが返す理由をそのまま見せる(どのプロパティがなぜ不正かが利用者に分かるように)。
      setSaveError(err instanceof Error ? err.message : 'マッピングの保存に失敗しました')
    }
  }

  return (
    <div className="space-y-2.5">
      {proposalSource === 'heuristic' && aiUnavailableReason && (
        <p className="text-[11px] text-gray-500 leading-relaxed">
          自動提案は使えませんでしたが、下で手で選べば同じように設定できます。
        </p>
      )}

      <p className="text-[11px] text-gray-400">
        タイトルはNotion側で自動的に判別するため、ここでは選びません。
      </p>

      <div>
        <label
          htmlFor={`notion-due-prop-${container.id}`}
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          期日として取り込むプロパティ
        </label>
        <select
          id={`notion-due-prop-${container.id}`}
          value={dueId}
          onChange={(e) => setDueId(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value={NONE_VALUE}>取り込まない</option>
          {dateProps.map((prop) => (
            <option key={prop.id} value={prop.id}>
              {prop.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={`notion-status-prop-${container.id}`}
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          完了として扱うプロパティ
        </label>
        <select
          id={`notion-status-prop-${container.id}`}
          value={statusPropId}
          onChange={(e) => handleStatusPropChange(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value={NONE_VALUE}>完了同期なし</option>
          {statusCapableProps.map((prop) => (
            <option key={prop.id} value={prop.id}>
              {prop.name}
            </option>
          ))}
        </select>
      </div>

      {selectedStatusProp && !isCheckbox && (
        <div className="pl-2 border-l-2 border-gray-100 space-y-2">
          <div>
            <p className="text-xs font-medium text-gray-700 mb-1">完了とみなす選択肢(複数可)</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {statusOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={doneOptionIds.includes(option.id)}
                    onChange={() => toggleDoneOption(option.id)}
                    aria-label={option.name}
                  />
                  {option.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-1">完了時にNotionへ書き戻す選択肢</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-700">
                <input
                  type="radio"
                  name={`notion-write-done-${container.id}`}
                  checked={writeDoneOptionId === NONE_VALUE}
                  onChange={() => setWriteDoneOptionId(NONE_VALUE)}
                />
                書き戻さない
              </label>
              {statusOptions
                .filter((option) => doneOptionIds.includes(option.id))
                .map((option) => (
                  <label key={option.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <input
                      type="radio"
                      name={`notion-write-done-${container.id}`}
                      checked={writeDoneOptionId === option.id}
                      onChange={() => setWriteDoneOptionId(option.id)}
                    />
                    {option.name}
                  </label>
                ))}
            </div>
          </div>
        </div>
      )}

      {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || save.isPending}
          className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {save.isPending ? '保存中...' : 'この設定で取り込む'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md px-3 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}
