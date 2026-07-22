'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowsClockwise, CaretDown, CaretRight, CheckCircle } from '@phosphor-icons/react'
import {
  useConnectionContainers,
  useAddKintoneApp,
  useRemoveKintoneApp,
  useKintoneMappingProposal,
  useSaveKintoneMapping,
  type ConnectorConnection,
  type KintoneMappingCandidate,
  type KintoneSchema,
  type KintoneStatusMappingInput,
} from '@/lib/hooks/useConnectors'
import { parseKintoneAppUrl } from '@/lib/task-sync/providers/kintone/appUrl'
import { normalizeKintoneAppIds } from '@/lib/task-sync/providers/kintone/mapping'
import { MAX_API_TOKENS_PER_REQUEST } from '@/lib/task-sync/providers/kintone/client'
import { KintoneAppUpdateReminder } from '@/components/secretary/integrations/KintoneAppUpdateReminder'

interface KintoneAppsPanelProps {
  orgId: string
  connection: ConnectorConnection
  canManage: boolean
}

/** kintoneの完了対応づけに使える型(mapping.tsのKintoneStatusFieldTypeと同じ4種)。 */
const STATUS_CAPABLE_TYPES = new Set(['STATUS', 'DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX'])

/** UIの選択欄で使う「未設定」を表す特別値(propが無い/選ばない = null)。 */
const NONE_VALUE = ''

/**
 * kintoneアプリの登録管理(追加・削除)＋マッピングウィザード。
 *
 * ⚠ 正本の使い分け(バッジの真実源を二重化しない。実装ランナーへの委任事項への回答):
 *   - 「登録済みアプリ」一覧の正本は `import_config.kintone_app_ids`（接続の設定意図。
 *     kintone/mapping/route.ts と同じ「kintone_app_idsが正本」の設計）。containers一覧
 *     (listContainers)はトークン失効等で一部アプリを静かにスキップし得る
 *     (providers/kintone.ts の listContainers 参照。403/404を返すアプリは結果から除かれる)ため、
 *     「登録されているか」の判定にcontainers一覧を使うと、失効したアプリが一覧から消えて
 *     二度と削除できなくなる。containers一覧は各アプリの**表示タイトル**を補うためだけに使う
 *     (取得できなければ生のapp_idをそのまま表示する。UXの補助情報であり真実源ではない)。
 *   - 「設定済み/未設定」バッジの正本は `import_config.kintone_mappings[app_id]` の有無のみ
 *     （Notionのread_container_idsのような別の真実源と二重化しない。同じ理由で
 *     useSaveKintoneMappingはcontainers一覧を無効化しない）。
 *
 * ⚠ 表示速度是正(実装ランナーへの委任事項への回答): 一覧(`<ul>`)は上記の通り`appIds`から
 * **無条件に**描画する。containers(useConnectionContainers。最大9アプリぶんの直列外部往復)の
 * `isLoading`/`error`で一覧の描画そのものをゲートしない。containersは各行の**タイトル解決**
 * だけに使う(`isLoading`中はタイトル部分だけプレースホルダにし、`error`時は一覧を消さず
 * インライン注記に留める)。ゲートすると、手元に既にある正本(kintone_app_ids)の描画を
 * 外部往復の完了まで待たせるうえ、containersが502/409を返すと一覧ごと消えて削除ボタンも
 * 設定ボタンも操作できなくなり、上の「正本を分ける」設計そのものが描画層で無効化されてしまう。
 *
 * モーダル禁止。マッピング確定は「1回確認して確定する」性質の操作のため保存ボタンを持つ
 * (CLAUDE.mdの例外。NotionMappingEditorと同じ扱い)。他の操作(削除・アプリ追加)はoptimistic。
 */
export function KintoneAppsPanel({ orgId, connection, canManage }: KintoneAppsPanelProps) {
  const { containers, isLoading, error, refetch } = useConnectionContainers(orgId, connection.id, canManage)
  const [editingAppId, setEditingAppId] = useState<string | null>(null)
  // アプリの追加は KintoneAddAppForm 内部で独自に useAddKintoneApp() を呼ぶ(フォームの
  // 開閉・入力state自体をそのコンポーネントに閉じ込めるため。ここでは削除のみ扱う)。
  const removeApp = useRemoveKintoneApp()

  const appIds = normalizeKintoneAppIds(connection.importConfig.kintone_app_ids)
  const kintoneMappings = (connection.importConfig.kintone_mappings ?? {}) as Record<string, unknown>

  // 「保存中に別アプリのエディタへ切り替える」を跨いでも、閉じるのは「保存/削除した本人の
  // エディタが今も開いていれば」だけにする(NotionImportPanel.tsxのcloseEditorIfCurrentと同じ設計)。
  const closeEditorIfCurrent = (appId: string) => {
    setEditingAppId((current) => (current === appId ? null : current))
  }

  if (!canManage) {
    return <p className="text-[11px] text-gray-400">アプリの追加・削除・設定はowner/adminのみ行えます。</p>
  }

  const handleRemove = async (appId: string) => {
    try {
      await removeApp.mutateAsync({ orgId, connectionId: connection.id, appId })
      closeEditorIfCurrent(appId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'アプリの削除に失敗しました')
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-gray-900">登録済みアプリ</h3>
          <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
            アプリを選び、タイトル・期日・完了の対応づけを1回確認してから取り込みを開始します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
        >
          <ArrowsClockwise className="w-3 h-3" />
          再読み込み
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-600">
          タイトルを取得できませんでした({error})。一覧の操作(設定・削除)は引き続き行えます。
        </p>
      )}

      <ul className="space-y-1.5">
        {appIds.map((appId) => (
          <KintoneAppRow
            key={appId}
            orgId={orgId}
            connection={connection}
            appId={appId}
            title={isLoading ? null : (containers.find((c) => c.id === appId)?.title ?? appId)}
            isMapped={kintoneMappings[appId] !== undefined}
            isEditing={editingAppId === appId}
            isRemoving={removeApp.isPending}
            canRemove={appIds.length > 1}
            onStartEdit={() => setEditingAppId(appId)}
            onStopEdit={() => closeEditorIfCurrent(appId)}
            onRemove={() => void handleRemove(appId)}
          />
        ))}
      </ul>

      <KintoneAddAppForm orgId={orgId} connection={connection} appCount={appIds.length} />
    </section>
  )
}

interface KintoneAddAppFormProps {
  orgId: string
  connection: ConnectorConnection
  appCount: number
}

/**
 * 「アプリを追加」— 折りたたみ式のミニフォーム(1件ずつ追加。9個上限は事前にも案内する)。
 *
 * ⚠ 対応しないこと(実装ランナーへの委任事項への回答): `isPending`がUIへ反映される前に
 * 「追加する」を2回連打すると、外部往復(fetchAppFields)が2回走り得る。ただし正しさは
 * サーバ側の行ロック(rpc_kintone_apps_add)と重複app_id検出(KTDUP/409)で守られており、
 * 起きる実害はfetchAppFieldsの往復1回ぶんの無駄コストのみ(データ破損・二重登録は起きない)。
 * ボタン連打対策(mousedown無効化等)を足すコストの方が高いため、今回は対応しない。
 */
function KintoneAddAppForm({ orgId, connection, appCount }: KintoneAddAppFormProps) {
  const addApp = useAddKintoneApp()
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [token, setToken] = useState('')

  const atLimit = appCount >= MAX_API_TOKENS_PER_REQUEST
  const parsed = input.trim() ? parseKintoneAppUrl(input) : null
  const canSubmit = !!parsed?.ok && token.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed?.ok) return
    try {
      await addApp.mutateAsync({
        orgId,
        connectionId: connection.id,
        appId: parsed.data.appId,
        apiToken: token.trim(),
      })
      setInput('')
      setToken('')
      setExpanded(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'アプリの追加に失敗しました')
    }
  }

  if (atLimit) {
    return (
      <p className="text-[11px] text-gray-400">
        アプリは最大{MAX_API_TOKENS_PER_REQUEST}件まで登録できます(この接続は上限に達しています)。
      </p>
    )
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        + アプリを追加
      </button>
    )
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-md border border-gray-200 p-2.5 space-y-2">
      <KintoneAppUpdateReminder />
      <div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="アプリのURL または アプリID"
          aria-label="追加するアプリのURLまたはアプリID"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {input.trim().length > 0 && parsed && !parsed.ok && (
          <p className="mt-1 text-[11px] text-red-600">{parsed.reason}</p>
        )}
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="APIトークン"
        autoComplete="off"
        aria-label="追加するアプリのAPIトークン"
        className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit || addApp.isPending}
          className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {addApp.isPending ? '追加中...' : '追加する'}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false)
            setInput('')
            setToken('')
          }}
          className="h-8 rounded-md px-3 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </form>
  )
}

interface KintoneAppRowProps {
  orgId: string
  connection: ConnectorConnection
  appId: string
  /** null = タイトル解決中(containers取得中)。行自体は出し続け、タイトル部分だけプレースホルダにする。 */
  title: string | null
  isMapped: boolean
  isEditing: boolean
  isRemoving: boolean
  /** 登録アプリが1件だけの間は削除できない(接続は最低1アプリを持つ不変条件)。 */
  canRemove: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onRemove: () => void
}

function KintoneAppRow({
  orgId,
  connection,
  appId,
  title,
  isMapped,
  isEditing,
  isRemoving,
  canRemove,
  onStartEdit,
  onStopEdit,
  onRemove,
}: KintoneAppRowProps) {
  return (
    <li className="rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs text-gray-900 truncate flex-1">
          {title === null ? (
            <span className="inline-block h-3 w-24 bg-gray-100 rounded animate-pulse align-middle" />
          ) : (
            title
          )}
        </span>
        {isMapped ? (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-50 text-green-700 flex-shrink-0">
            <CheckCircle className="w-3 h-3" weight="fill" />
            取り込み中
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 flex-shrink-0">
            未設定
          </span>
        )}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => (isEditing ? onStopEdit() : onStartEdit())}
            className="flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {isEditing ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
            {isMapped ? '設定を変更' : '設定する'}
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={isRemoving}
              className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              削除
            </button>
          )}
        </div>
      </div>
      {isEditing && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          <KintoneMappingEditor orgId={orgId} connection={connection} appId={appId} onSaved={onStopEdit} onCancel={onStopEdit} />
        </div>
      )}
    </li>
  )
}

interface KintoneMappingEditorProps {
  orgId: string
  connection: ConnectorConnection
  appId: string
  onSaved: () => void
  onCancel: () => void
}

/**
 * タイトル・期日・完了の対応づけを1回確認して確定するエディタ(「AI提案＋人が1回確認」方式。
 * NotionMappingEditorと同じ設計)。
 *
 * ⚠ Notionとの違い:
 *   - タイトルは必須(kintoneには構造的なtitleが無いため。「取り込まない」選択肢を出さない)。
 *   - 完了フィールドがSTATUS型(プロセス管理)のときは、選択肢名・書き戻しアクション名を
 *     fields.jsonから列挙できない(mapping.ts冒頭コメント参照)ため、自由入力にする
 *     (DROP_DOWN/RADIO_BUTTON/CHECK_BOXは選択肢名が分かるためチェックボックスで選ばせる)。
 *   - write_done_actionはSTATUS型を選んだときだけ入力欄を出す(他の型で出すと保存APIに拒否される)。
 */
function KintoneMappingEditor({ orgId, connection, appId, onSaved, onCancel }: KintoneMappingEditorProps) {
  // useQuery化(useNotionMappingProposalと同じ理由): 展開/折りたたみのたびにLLMを呼び直さない。
  const proposal = useKintoneMappingProposal({ orgId, connectionId: connection.id, appId, enabled: true })
  const save = useSaveKintoneMapping()

  const [saveError, setSaveError] = useState<string | null>(null)
  const [titleFieldCode, setTitleFieldCode] = useState(NONE_VALUE)
  const [dueFieldCode, setDueFieldCode] = useState(NONE_VALUE)
  const [statusFieldCode, setStatusFieldCode] = useState(NONE_VALUE)
  const [doneValues, setDoneValues] = useState<string[]>([])
  const [doneValuesText, setDoneValuesText] = useState('')
  const [writeDoneAction, setWriteDoneAction] = useState('')

  function applyCandidate(candidate: KintoneMappingCandidate) {
    setTitleFieldCode(candidate.title_field_code ?? NONE_VALUE)
    setDueFieldCode(candidate.due_field_code ?? NONE_VALUE)
    setStatusFieldCode(candidate.status?.field_code ?? NONE_VALUE)
    if (candidate.status?.field_type === 'STATUS') {
      setDoneValues([])
      setDoneValuesText((candidate.status.done_values ?? []).join('、'))
      setWriteDoneAction(candidate.status.write_done_action ?? '')
    } else {
      setDoneValues(candidate.status?.done_values ?? [])
      setDoneValuesText('')
      setWriteDoneAction('')
    }
  }

  // 提案の取得結果(data)が新しく来たときだけ、フォームへ初期値を反映する(NotionMappingEditorと同じ)。
  const proposalData = proposal.data
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (proposalData) applyCandidate(proposalData.proposal)
  }, [proposalData])

  // 保存エラーは編集し直した時点で意味を失う(NotionMappingEditorと同じ意図的なリセット)。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError(null)
  }, [titleFieldCode, dueFieldCode, statusFieldCode, doneValues, doneValuesText, writeDoneAction])

  if (proposal.error) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-red-600">{proposal.error}</p>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
          閉じる
        </button>
      </div>
    )
  }

  if (!proposalData) {
    return <div className="h-16 w-full bg-gray-50 rounded animate-pulse" />
  }

  const schema: KintoneSchema = proposalData.schema
  const proposalSource = proposalData.proposalSource
  const aiUnavailableReason = proposalData.aiUnavailableReason ?? null

  const dateFields = schema.filter((f) => f.type === 'DATE')
  const statusCapableFields = schema.filter((f) => STATUS_CAPABLE_TYPES.has(f.type))
  const selectedStatusField = statusCapableFields.find((f) => f.code === statusFieldCode)
  const isStatusType = selectedStatusField?.type === 'STATUS'
  const statusOptions = selectedStatusField?.options ?? []

  const canSubmit =
    titleFieldCode.trim().length > 0 &&
    (!selectedStatusField || (isStatusType ? doneValuesText.trim().length > 0 : doneValues.length > 0))

  const toggleDoneOption = (optionName: string) => {
    setDoneValues((prev) => (prev.includes(optionName) ? prev.filter((v) => v !== optionName) : [...prev, optionName]))
  }

  const handleStatusFieldChange = (nextCode: string) => {
    setStatusFieldCode(nextCode)
    setDoneValues([])
    setDoneValuesText('')
    setWriteDoneAction('')
  }

  const handleSubmit = async () => {
    setSaveError(null)
    const status: KintoneStatusMappingInput | null = !selectedStatusField
      ? null
      : isStatusType
        ? {
            field_code: selectedStatusField.code,
            field_type: 'STATUS',
            // 選択肢名(プロセス管理のステータス名)はfields.jsonから列挙できないため自由入力
            // (mapping.ts冒頭コメントの限界と同じ)。全角/半角どちらの区切りも受理する。
            done_values: doneValuesText
              .split(/[,、]/)
              .map((v) => v.trim())
              .filter((v) => v.length > 0),
            write_done_action: writeDoneAction.trim() || null,
          }
        : {
            field_code: selectedStatusField.code,
            field_type: selectedStatusField.type as 'DROP_DOWN' | 'RADIO_BUTTON' | 'CHECK_BOX',
            done_values: doneValues,
            write_done_action: null,
          }

    const mapping: KintoneMappingCandidate = {
      title_field_code: titleFieldCode,
      due_field_code: dueFieldCode || null,
      status,
    }

    try {
      await save.mutateAsync({ orgId, connectionId: connection.id, appId, mapping })
      onSaved()
    } catch (err) {
      // 保存APIが返す理由をそのまま見せる(どのフィールドがなぜ不正かが利用者に分かるように)。
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

      <div>
        <label htmlFor={`kintone-title-field-${appId}`} className="block text-xs font-medium text-gray-700 mb-1">
          タイトルとして取り込むフィールド
        </label>
        <select
          id={`kintone-title-field-${appId}`}
          value={titleFieldCode}
          onChange={(e) => setTitleFieldCode(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value={NONE_VALUE} disabled>
            選択してください
          </option>
          {schema.map((field) => (
            <option key={field.code} value={field.code}>
              {field.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`kintone-due-field-${appId}`} className="block text-xs font-medium text-gray-700 mb-1">
          期日として取り込むフィールド
        </label>
        <select
          id={`kintone-due-field-${appId}`}
          value={dueFieldCode}
          onChange={(e) => setDueFieldCode(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value={NONE_VALUE}>取り込まない</option>
          {dateFields.map((field) => (
            <option key={field.code} value={field.code}>
              {field.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`kintone-status-field-${appId}`} className="block text-xs font-medium text-gray-700 mb-1">
          完了として扱うフィールド
        </label>
        <select
          id={`kintone-status-field-${appId}`}
          value={statusFieldCode}
          onChange={(e) => handleStatusFieldChange(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value={NONE_VALUE}>完了同期なし</option>
          {statusCapableFields.map((field) => (
            <option key={field.code} value={field.code}>
              {field.label}
            </option>
          ))}
        </select>
      </div>

      {selectedStatusField && !isStatusType && (
        <div className="pl-2 border-l-2 border-gray-100 space-y-1">
          <p className="text-xs font-medium text-gray-700 mb-1">完了とみなす選択肢(複数可)</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {statusOptions.map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={doneValues.includes(option)}
                  onChange={() => toggleDoneOption(option)}
                  aria-label={option}
                />
                {option}
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedStatusField && isStatusType && (
        <div className="pl-2 border-l-2 border-gray-100 space-y-2">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            プロセス管理のステータスは選択肢の一覧をこの画面から取得できないため、名前を直接入力してください。
          </p>
          <div>
            <label htmlFor={`kintone-done-values-${appId}`} className="block text-xs font-medium text-gray-700 mb-1">
              完了とみなすステータス名(複数はカンマ区切り)
            </label>
            <input
              id={`kintone-done-values-${appId}`}
              type="text"
              value={doneValuesText}
              onChange={(e) => setDoneValuesText(e.target.value)}
              placeholder="完了、却下"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor={`kintone-write-done-action-${appId}`} className="block text-xs font-medium text-gray-700 mb-1">
              完了時にkintoneへ書き戻すアクション名(任意)
            </label>
            <input
              id={`kintone-write-done-action-${appId}`}
              type="text"
              value={writeDoneAction}
              onChange={(e) => setWriteDoneAction(e.target.value)}
              placeholder="完了にする"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
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
