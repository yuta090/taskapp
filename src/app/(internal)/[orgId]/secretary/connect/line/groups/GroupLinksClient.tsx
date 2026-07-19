'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  Check,
  Warning,
  Spinner,
  CheckCircle,
  XCircle,
  ChatCircleDots,
  ClipboardText,
  Sparkle,
} from '@phosphor-icons/react'
import { LineFriendQr } from '@/components/secretary/LineFriendQr'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'

/**
 * 相手先グループ数の上限(402 group_limit_reached)を踏んだ際のProアップセル注記。
 * 押し付けにならないよう1行＋導線リンクのみ（設定は他ストリームのゲート実装＝#287）。
 */
/**
 * 承認待ち一覧の静かなポーリング間隔。相手先がグループに参加した数秒後に自動反映させるため、
 * 1対1の接続待ち画面(ClientLinkPanel→useChannelIdentities polling:true)と揃えて15秒(WAITINGティア)。
 */
const PENDING_CLAIMS_POLL_INTERVAL_MS = 15_000

function LineProUpsellNote() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
      <Sparkle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" weight="fill" />
      <span>
        自社LINE(Pro)なら、自社の名前で・即時・送信の上限なし。{' '}
        <Link href="/settings/billing" className="underline hover:text-amber-800">
          プランを見る
        </Link>
      </span>
    </p>
  )
}

interface PendingGroupClaimItem {
  id: string
  externalGroupId: string
  spaceId: string
  spaceName: string | null
  challengeLabel: string | null
  groupDisplayNameSnapshot: string | null
  createdAt: string
}

interface IssuedCode {
  code: string
  expiresAt: string
}

interface IssuedBatchItem {
  spaceId: string
  displayCode: string
}

/**
 * 共有botグループ紐付け承認コンソール（Stage 4・PR3a）— /{orgId}/secretary/connect/line/groups
 *
 * promoteのdigest承認（ApprovalsClient・"確認待ち"タブ）とは別概念。こちらは
 * channel_group_claims（web_approval）を扱う: 事務所がプロジェクトを選んでコードを発行し、
 * 相手先がLINEグループに投入すると、下に確認待ちとして現れる。承認するとグループが紐付く。
 * 楽観更新: 承認/却下が成功したら即座にリストから消す（保存ボタンは無い）。
 */
export function GroupLinksClient({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient()
  const { spaces } = useUserSpaces()
  const orgSpaces = spaces.filter((s) => s.orgId === orgId)

  const [selectedSpaceId, setSelectedSpaceId] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issuedCode, setIssuedCode] = useState<IssuedCode | null>(null)
  const [copied, setCopied] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  // 相手先グループ数の上限(402 group_limit_reached)は通常エラーと別扱い(Proアップセル)。
  const [issueGroupLimitReached, setIssueGroupLimitReached] = useState(false)

  const [items, setItems] = useState<PendingGroupClaimItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [rowGroupLimitReached, setRowGroupLimitReached] = useState<Record<string, boolean>>({})
  // ポーリング(reloadのsilent実行)がbusy(承認/却下処理中)の行を巻き戻さないためのガード。
  // busy stateは非同期に更新されるため、setInterval側のコールバックから常に最新値を読めるようrefで併走する。
  const busyRef = useRef<Record<string, 'approve' | 'reject'>>({})
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  // 本部一括発行（code_only・entitlementがある時だけ表示。設計正本 §3・PR3b）
  const [allowCodeOnly, setAllowCodeOnly] = useState(false)
  const [batchSelectedSpaceIds, setBatchSelectedSpaceIds] = useState<Set<string>>(new Set())
  const [batchIssuing, setBatchIssuing] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchIssued, setBatchIssued] = useState<{ items: IssuedBatchItem[]; expiresAt: string } | null>(
    null,
  )
  const [batchCopied, setBatchCopied] = useState(false)

  /**
   * @param options.silent true のときは初回ロード用のloading/loadErrorに触れず、
   *   itemsだけを裏で静かに差し替える(ポーリング用)。画面をチラつかせない。
   */
  const reload = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true
      if (!silent) {
        setLoading(true)
        setLoadError(null)
      }
      try {
        const res = await fetch(`/api/channels/group-claims/pending?orgId=${orgId}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? '取得に失敗しました')
        const nextItems: PendingGroupClaimItem[] = json.items ?? []
        if (silent) {
          setItems((prev) => {
            // busy(承認/却下処理中)の行は、サーバがまだcommit前の状態を返して復活させないよう
            // ポーリング結果で上書きしない。処理中の行は直前のprevをそのまま残す。
            const busyIds = new Set(Object.keys(busyRef.current))
            if (busyIds.size === 0) return nextItems
            const preservedBusy = prev.filter((it) => busyIds.has(it.id))
            const merged = nextItems.filter((it) => !busyIds.has(it.id))
            return [...merged, ...preservedBusy]
          })
        } else {
          setItems(nextItems)
        }
      } catch (e) {
        // silent(ポーリング)の取得失敗は既存表示を保持する(画面を赤くしない)。初回ロード失敗のみエラー表示。
        if (!silent) {
          setLoadError(e instanceof Error ? e.message : '取得に失敗しました')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [orgId],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  // 静かなポーリング: 相手先がグループに参加した数秒後に自動反映させる(1対1接続待ち画面と揃える)。
  // タブが非表示の間はfetchをスキップする(react-queryのrefetchIntervalInBackground:falseと挙動を揃える)。
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void reload({ silent: true })
    }, PENDING_CLAIMS_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [reload])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/channels/group-claims/policy?orgId=${orgId}`)
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        if (!cancelled) setAllowCodeOnly(json.allowCodeOnly === true)
      } catch {
        // entitlement判定に失敗してもコンソール本体は使えるようにする（セクション非表示のまま）
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const toggleBatchSpace = (spaceId: string) => {
    setBatchSelectedSpaceIds((prev) => {
      const next = new Set(prev)
      if (next.has(spaceId)) next.delete(spaceId)
      else next.add(spaceId)
      return next
    })
  }

  const issueBatch = async () => {
    const spaceIds = [...batchSelectedSpaceIds]
    if (spaceIds.length === 0) return
    setBatchIssuing(true)
    setBatchError(null)
    try {
      const res = await fetch('/api/channels/group-claims/issue-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, spaceIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'コードの発行に失敗しました')
      // 平文はこの一度きり。画面を離れたら二度と表示できない
      setBatchIssued({ items: json.items ?? [], expiresAt: json.expiresAt })
      setBatchCopied(false)
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : 'コードの発行に失敗しました')
    } finally {
      setBatchIssuing(false)
    }
  }

  const copyBatch = async () => {
    if (!batchIssued) return
    const tsv = batchIssued.items
      .map((it) => {
        const name = orgSpaces.find((s) => s.id === it.spaceId)?.name ?? it.spaceId
        return `${name}\t${it.displayCode}`
      })
      .join('\n')
    await navigator.clipboard.writeText(tsv)
    setBatchCopied(true)
  }

  const issue = async () => {
    if (!selectedSpaceId) return
    setIssuing(true)
    setIssueError(null)
    setIssueGroupLimitReached(false)
    try {
      const res = await fetch('/api/channels/group-claims/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, spaceId: selectedSpaceId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 402 && json.code === 'group_limit_reached') {
          setIssueGroupLimitReached(true)
          return
        }
        throw new Error(json.error ?? 'コードの発行に失敗しました')
      }
      // 平文はこの一度きり。画面を離れたら二度と表示できない
      setIssuedCode({ code: json.code, expiresAt: json.expiresAt })
      setCopied(false)
    } catch (e) {
      setIssueError(e instanceof Error ? e.message : 'コードの発行に失敗しました')
    } finally {
      setIssuing(false)
    }
  }

  const copy = async () => {
    if (!issuedCode) return
    await navigator.clipboard.writeText(issuedCode.code)
    setCopied(true)
  }

  const act = useCallback(
    async (claimId: string, action: 'approve' | 'reject') => {
      setBusy((b) => ({ ...b, [claimId]: action }))
      setRowError((e) => {
        const next = { ...e }
        delete next[claimId]
        return next
      })
      setRowGroupLimitReached((e) => {
        const next = { ...e }
        delete next[claimId]
        return next
      })
      try {
        const res = await fetch('/api/channels/group-claims/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, claimId, action }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          // 409 は他経路(別タブ・同時操作)で既に処理済み。その場合もリストから消して整合させる
          if (res.status === 409) {
            setItems((prev) => prev.filter((it) => it.id !== claimId))
            return
          }
          // 相手先グループ数の上限(402 group_limit_reached): 承認は成立しない(行は残す)。
          // 通常エラーではなくProアップセル注記を出す。
          if (res.status === 402 && json.code === 'group_limit_reached') {
            setRowGroupLimitReached((prev) => ({ ...prev, [claimId]: true }))
            return
          }
          const msg =
            res.status === 403
              ? 'この操作を行う権限がありません。'
              : res.status === 404
                ? '対象が見つかりませんでした。'
                : (json.error ?? '処理に失敗しました')
          throw new Error(msg)
        }
        // 楽観更新: 成功したら消す
        setItems((prev) => prev.filter((it) => it.id !== claimId))
        // 承認(approve)は rpc_approve_group_claim が channel_groups を新規active化する。
        // 秘書コンソール左カラム等の接続バッジ(useChannelGroups/useChannelGroupCounts)が
        // STRUCTUREティア(5分SWR)で固定されているため、承認直後に無効化して反映させる。
        // 却下(reject)は channel_groups を作らないため対象外(STRUCTURE規約)。
        if (action === 'approve') {
          void queryClient.invalidateQueries({ queryKey: ['channelGroups', orgId] })
          void queryClient.invalidateQueries({ queryKey: ['channelGroupCounts', orgId] })
        }
      } catch (e) {
        setRowError((prev) => ({
          ...prev,
          [claimId]: e instanceof Error ? e.message : '処理に失敗しました',
        }))
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[claimId]
          return next
        })
      }
    },
    [orgId, queryClient],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-gray-900">共有botグループを追加</h2>
            <p className="mt-1 text-xs text-gray-500">
              相手先がまだ秘書を友だち追加していない場合は、下のQRで秘書を友だち追加してもらい、
              その秘書を<strong>LINEグループに招待</strong>してもらいます。そのうえでプロジェクトを選んでコードを発行し、
              <strong>相手先のLINEグループのトーク</strong>に貼り付けてもらってください。投入されると下に確認待ちが表示され、
              承認するとグループが紐付きます。
            </p>

            <div className="mt-3">
              <LineFriendQr orgId={orgId} purpose="group" />
            </div>

            {issueError && (
              <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{issueError}</span>
              </div>
            )}

            {issueGroupLimitReached && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">
                  接続できる相手先グループ数の上限に達しています。
                </p>
                <LineProUpsellNote />
              </div>
            )}

            {issuedCode ? (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-4">
                <p className="text-xs font-semibold text-amber-900">
                  このコードをLINEグループに貼り付けてください。承認するとここに確認待ちが出ます。
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm tracking-wider text-gray-900">
                    {issuedCode.code}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'コピー済み' : 'コピー'}
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-amber-900">
                  <li>・有効期限は30分です。1グループのみ紐付けできます。</li>
                  <li>・この画面を離れると再表示できません（再発行してください）。</li>
                </ul>
                <button
                  type="button"
                  onClick={() => setIssuedCode(null)}
                  className="mt-3 text-xs text-gray-500 underline hover:no-underline"
                >
                  別のコードを発行する
                </button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                {orgSpaces.length === 0 ? (
                  <p className="text-xs text-gray-500">プロジェクトがありません。</p>
                ) : (
                  <>
                    <select
                      value={selectedSpaceId}
                      onChange={(e) => setSelectedSpaceId(e.target.value)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="">プロジェクトを選択</option>
                      {orgSpaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedSpaceId || issuing}
                      onClick={() => void issue()}
                      className="rounded bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      {issuing ? '発行中...' : 'コードを発行'}
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          {allowCodeOnly && (
            <section className="border-t border-gray-100 pt-6">
              <h2 className="text-sm font-semibold text-gray-900">本部一括発行</h2>
              <p className="mt-1 text-xs text-gray-500">
                複数のプロジェクトへ一度にcode_onlyコードを発行します。承認は不要で、投入されると即座に紐付きます。
                各コードは1グループのみ・単回のみ有効です。
              </p>

              {batchError && (
                <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{batchError}</span>
                </div>
              )}

              {batchIssued ? (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-4">
                  <p className="text-xs font-semibold text-amber-900">
                    以下のコードを各拠点へお渡しください。この画面を離れると再表示できません。
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {batchIssued.items.map((it) => {
                      const spaceName = orgSpaces.find((s) => s.id === it.spaceId)?.name ?? it.spaceId
                      return (
                        <li
                          key={it.spaceId}
                          className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white px-3 py-2"
                        >
                          <span className="text-xs font-medium text-gray-700">{spaceName}</span>
                          <code className="font-mono text-xs tracking-wider text-gray-900">{it.displayCode}</code>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyBatch()}
                      className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {batchCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {batchCopied ? 'コピー済み' : 'まとめてコピー'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchIssued(null)
                        setBatchSelectedSpaceIds(new Set())
                      }}
                      className="text-xs text-gray-500 underline hover:no-underline"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              ) : orgSpaces.length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">プロジェクトがありません。</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
                    {orgSpaces.map((s) => (
                      <li key={s.id}>
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={batchSelectedSpaceIds.has(s.id)}
                            onChange={() => toggleBatchSpace(s.id)}
                          />
                          {s.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={batchSelectedSpaceIds.size === 0 || batchIssuing}
                    onClick={() => void issueBatch()}
                    className="rounded bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {batchIssuing ? '発行中...' : '一括発行'}
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="border-t border-gray-100 pt-6">
            <h3 className="text-sm font-semibold text-gray-900">確認待ち</h3>
            <p className="mt-1 text-xs text-gray-500">
              LINEグループにコードが投入されました。グループ名を確認のうえ承認してください。
            </p>

            {loadError && (
              <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="ml-auto underline hover:no-underline"
                >
                  再読み込み
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
                <Spinner className="w-4 h-4 animate-spin" />
                読み込み中...
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <ClipboardText className="w-8 h-8 text-gray-300" />
                <p className="text-sm text-gray-500">確認待ちのグループはありません。</p>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {items.map((item) => {
                  const acting = busy[item.id]
                  const err = rowError[item.id]
                  const limitReached = rowGroupLimitReached[item.id]
                  return (
                    <li key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
                      <p className="text-sm font-medium text-gray-900">
                        {item.groupDisplayNameSnapshot ?? '(グループ名不明)'}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        {item.spaceName && (
                          <span className="inline-flex items-center gap-1">
                            <ChatCircleDots className="w-3.5 h-3.5" />
                            {item.spaceName}
                          </span>
                        )}
                        {item.challengeLabel && <span>確認番号: {item.challengeLabel}</span>}
                      </div>

                      {err && (
                        <p className="mt-2 rounded bg-red-50 border border-red-200 px-2 py-1.5 text-xs text-red-700">
                          {err}
                        </p>
                      )}

                      {limitReached && (
                        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                          <p className="text-xs text-amber-800">
                            接続できる相手先グループ数の上限に達しているため承認できません。
                          </p>
                          <LineProUpsellNote />
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={() => void act(item.id, 'approve')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {acting === 'approve' ? (
                            <Spinner className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle weight="bold" className="w-3.5 h-3.5" />
                          )}
                          承認
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={() => void act(item.id, 'reject')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {acting === 'reject' ? (
                            <Spinner className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <XCircle weight="bold" className="w-3.5 h-3.5" />
                          )}
                          却下
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
