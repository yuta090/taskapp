'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CurrencyJpy, ArrowSquareOut, Warning, CheckCircle, Spinner } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ViewsTabNav } from '@/components/shared/ViewsTabNav'
import { IMPLEMENTED_ACCOUNTING_PROVIDERS } from '@/lib/accounting/implemented'

/**
 * 見積書・請求書の発行画面。
 *
 * ⚠ ここで会計サービスへ渡すのは書類だけ。仕訳・入出金・決算は扱わない。
 *
 * 「タスクを選んで1枚にまとめる」が発行の単位。1件だけ選べば1タスク=1枚にもなるので、
 * 月次の一括請求と単発の見積の両方をこの1画面で賄える。
 */

const PROVIDER_LABEL: Record<string, string> = {
  freee: 'freee請求書',
  money_forward: 'マネーフォワード クラウド請求書',
  misoca: 'Misoca',
}

const DOC_TYPE_LABEL = { quote: '見積書', invoice: '請求書' } as const
type DocType = keyof typeof DOC_TYPE_LABEL

/** 発行済み書類の状態表示。色は意味のあるところにだけ乗せる。 */
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-gray-50 text-gray-600' },
  issued: { label: '発行済み', cls: 'bg-blue-50 text-blue-600' },
  paid: { label: '入金済み', cls: 'bg-green-50 text-green-600' },
  accepted: { label: '受注', cls: 'bg-green-50 text-green-600' },
  canceled: { label: '取消', cls: 'bg-gray-50 text-gray-500' },
  unknown: { label: '確認中', cls: 'bg-gray-50 text-gray-500' },
}

interface TaskRow {
  id: string
  title: string
  status: string
}

interface PricingRow {
  task_id: string
  sell_total: string | number | null
}

interface PartnerLinkRow {
  provider: string
  external_partner_id: string
  external_partner_name: string | null
}

interface DocumentRow {
  id: string
  provider: string
  doc_type: DocType
  document_number: string | null
  status: string
  total_amount: string | number | null
  web_url: string | null
  issued_at: string | null
}

interface Partner {
  id: string
  name: string
  hint?: string | null
}

function yen(value: number | null): string {
  if (value == null) return '—'
  return `¥${value.toLocaleString()}`
}

export function BillingPageClient({ orgId, spaceId }: { orgId: string; spaceId: string }) {
  const supabase = useMemo(() => createClient() as SupabaseClient, [])
  const queryClient = useQueryClient()

  const [docType, setDocType] = useState<DocType>('invoice')
  const [provider, setProvider] = useState<string>(IMPLEMENTED_ACCOUNTING_PROVIDERS[0])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [taxRate, setTaxRate] = useState<10 | 8 | 0>(10)
  const [issuing, setIssuing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 4本とも独立。react-query が並列に走らせるので待ち行列（waterfall）にならない
  const tasksQuery = useQuery({
    queryKey: ['billing-tasks', spaceId],
    staleTime: 60_000,
    queryFn: async (): Promise<TaskRow[]> => {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status')
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .limit(500)
      return (data ?? []) as TaskRow[]
    },
  })

  const pricingQuery = useQuery({
    queryKey: ['billing-pricing', spaceId],
    staleTime: 60_000,
    queryFn: async (): Promise<PricingRow[]> => {
      const { data } = await supabase.from('task_pricing').select('task_id, sell_total').eq('space_id', spaceId)
      return (data ?? []) as PricingRow[]
    },
  })

  const partnerLinkQuery = useQuery({
    queryKey: ['billing-partner-link', spaceId],
    staleTime: 60_000,
    queryFn: async (): Promise<PartnerLinkRow[]> => {
      const { data } = await supabase
        .from('accounting_partner_links')
        .select('provider, external_partner_id, external_partner_name')
        .eq('space_id', spaceId)
      return (data ?? []) as PartnerLinkRow[]
    },
  })

  const documentsQuery = useQuery({
    queryKey: ['billing-documents', spaceId],
    staleTime: 30_000,
    queryFn: async (): Promise<DocumentRow[]> => {
      const res = await fetch(`/api/accounting/documents?spaceId=${spaceId}`)
      if (!res.ok) return []
      return (await res.json()).documents ?? []
    },
  })

  // 取引先の候補は「選ぶ」を押したときだけ取りに行く（開かない人に外部APIを叩かせない）
  const partnersQuery = useQuery({
    queryKey: ['billing-partners', spaceId, provider],
    enabled: pickerOpen,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Partner[]> => {
      const res = await fetch(`/api/accounting/partners?spaceId=${spaceId}&provider=${provider}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '取引先を取得できませんでした')
      return body.partners ?? []
    },
  })

  const priceMap = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const row of pricingQuery.data ?? []) {
      map.set(row.task_id, row.sell_total == null ? null : Number(row.sell_total))
    }
    return map
  }, [pricingQuery.data])

  const currentLink = (partnerLinkQuery.data ?? []).find((l) => l.provider === provider) ?? null

  const selectedTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((t) => selected.has(t.id)),
    [tasksQuery.data, selected],
  )
  const missingAmount = selectedTasks.filter((t) => priceMap.get(t.id) == null)
  const subtotal = selectedTasks.reduce((sum, t) => sum + (priceMap.get(t.id) ?? 0), 0)
  const tax = Math.floor((subtotal * taxRate) / 100)

  function toggle(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function choosePartner(partner: Partner) {
    const res = await fetch('/api/accounting/partners', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId,
        provider,
        externalPartnerId: partner.id,
        externalPartnerName: partner.name,
      }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? '保存できませんでした')
      return
    }
    setPickerOpen(false)
    queryClient.invalidateQueries({ queryKey: ['billing-partner-link', spaceId] })
    toast.success(`発行先を「${partner.name}」にしました`)
  }

  async function issue() {
    setIssuing(true)
    try {
      const res = await fetch('/api/accounting/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          provider,
          docType,
          taskIds: [...selected],
          taxRate,
        }),
      })
      const body = await res.json()

      if (res.status === 409 && body.document) {
        toast.error('同じ内容の書類はすでに発行済みです')
      } else if (!res.ok) {
        toast.error(body.error ?? '発行できませんでした')
      } else {
        toast.success(`${DOC_TYPE_LABEL[docType]}を作成しました`)
        setSelected(new Set())
        queryClient.invalidateQueries({ queryKey: ['billing-documents', spaceId] })
      }
    } catch (err) {
      toast.error(`発行できませんでした: ${(err as Error).message}`)
    } finally {
      setIssuing(false)
    }
  }

  const canIssue = selected.size > 0 && missingAmount.length === 0 && currentLink != null && !issuing

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-gray-25">
      <ViewsTabNav orgId={orgId} spaceId={spaceId} activeView="billing" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 flex flex-col gap-6">
          {/* 範囲の明示。会計データ全般が繋がると誤解させない */}
          <div className="rounded-lg border border-gray-200 bg-surface p-4 flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-gray-900">見積書・請求書の作成</h1>
            <p className="text-xs text-gray-500">
              選んだタスクをまとめて1枚の書類にします。作成するのは見積書・請求書だけで、会計帳簿や仕訳は連携しません。
            </p>
          </div>

          {/* 発行の条件 */}
          <div className="rounded-lg border border-gray-200 bg-surface p-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-gray-500">書類</span>
                <div className="flex gap-1">
                  {(Object.keys(DOC_TYPE_LABEL) as DocType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => setDocType(type)}
                      className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                        docType === type
                          ? 'bg-indigo-600 text-white'
                          : 'bg-surface text-gray-700 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {DOC_TYPE_LABEL[type]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-gray-500">連携先</span>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="h-8 rounded-md border border-gray-200 bg-surface px-2 text-xs text-gray-700"
                >
                  {IMPLEMENTED_ACCOUNTING_PROVIDERS.map((id) => (
                    <option key={id} value={id}>
                      {PROVIDER_LABEL[id]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-gray-500">税率</span>
                <select
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value) as 10 | 8 | 0)}
                  className="h-8 rounded-md border border-gray-200 bg-surface px-2 text-xs text-gray-700"
                >
                  <option value={10}>10%</option>
                  <option value={8}>8%（軽減）</option>
                  <option value={0}>非課税</option>
                </select>
              </div>

              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-2xs font-medium text-gray-500">発行先</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-700 truncate">
                    {currentLink ? currentLink.external_partner_name || currentLink.external_partner_id : '未設定'}
                  </span>
                  <button
                    onClick={() => setPickerOpen((v) => !v)}
                    className="h-8 rounded-md px-3 text-xs font-medium bg-surface text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors flex-none"
                  >
                    {currentLink ? '変更' : '選ぶ'}
                  </button>
                </div>
              </div>
            </div>

            {pickerOpen && (
              <div className="rounded-lg border border-gray-200 bg-gray-25 p-3 flex flex-col gap-2">
                <p className="text-2xs text-gray-500">
                  {PROVIDER_LABEL[provider]}に登録済みの取引先から選びます。ここで新しい取引先は作りません。
                </p>
                {partnersQuery.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Spinner className="w-3.5 h-3.5 animate-spin" />
                    読み込み中…
                  </div>
                )}
                {partnersQuery.isError && (
                  <p className="text-xs text-red-600">{(partnersQuery.error as Error).message}</p>
                )}
                <div className="max-h-56 overflow-y-auto flex flex-col">
                  {(partnersQuery.data ?? []).map((partner) => (
                    <button
                      key={partner.id}
                      onClick={() => choosePartner(partner)}
                      className="text-left px-2 py-2 text-xs text-gray-700 hover:bg-gray-50 rounded transition-colors"
                    >
                      {partner.name}
                      {partner.hint && <span className="text-gray-400 ml-2">{partner.hint}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* タスク選択 */}
          <div className="rounded-lg border border-gray-200 bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">書類に入れるタスク</span>
              <span className="text-2xs text-gray-500">{selected.size}件を選択中</span>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {(tasksQuery.data ?? []).map((task) => {
                const amount = priceMap.get(task.id) ?? null
                const isSelected = selected.has(task.id)
                return (
                  <label
                    key={task.id}
                    className={`flex items-center gap-3 px-4 h-10 border-b border-gray-100 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(task.id)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="flex-1 text-xs text-gray-700 truncate">{task.title}</span>
                    <span
                      className={`text-xs tabular-nums ${amount == null ? 'text-gray-400' : 'text-gray-900'}`}
                    >
                      {amount == null ? '金額未入力' : yen(amount)}
                    </span>
                  </label>
                )
              })}
              {tasksQuery.data?.length === 0 && (
                <p className="px-4 py-6 text-xs text-gray-500">タスクがありません。</p>
              )}
            </div>

            <div className="px-4 py-3 bg-gray-25 border-t border-gray-100 flex flex-col gap-3">
              {missingAmount.length > 0 && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <Warning className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-none" weight="fill" />
                  <p className="text-2xs text-amber-600">
                    金額が入っていないタスクが{missingAmount.length}件あります。0円で出さないよう発行を止めています。
                    先にタスクの見積金額を入れてください。
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 text-xs text-gray-700 tabular-nums">
                  <span>
                    小計 <span className="text-gray-900 font-medium">{yen(subtotal)}</span>
                  </span>
                  <span className="text-gray-500">
                    消費税 {yen(tax)}
                  </span>
                  <span>
                    合計 <span className="text-gray-900 font-medium">{yen(subtotal + tax)}</span>
                  </span>
                </div>

                <button
                  onClick={issue}
                  disabled={!canIssue}
                  className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600 inline-flex items-center gap-1.5"
                >
                  {issuing ? (
                    <Spinner className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CurrencyJpy className="w-3.5 h-3.5" />
                  )}
                  {DOC_TYPE_LABEL[docType]}を作る
                </button>
              </div>

              {!currentLink && (
                <p className="text-2xs text-gray-500">発行先の取引先を選ぶと作成できます。</p>
              )}
            </div>
          </div>

          {/* 発行履歴 */}
          <div className="rounded-lg border border-gray-200 bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-700">発行した書類</span>
            </div>
            <div className="overflow-x-auto">
              {(documentsQuery.data ?? []).length === 0 ? (
                <p className="px-4 py-6 text-xs text-gray-500">まだ発行した書類はありません。</p>
              ) : (
                (documentsQuery.data ?? []).map((doc) => {
                  const badge = STATUS_BADGE[doc.status] ?? STATUS_BADGE.unknown
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 px-4 h-10 border-b border-gray-100 last:border-b-0"
                    >
                      <span className="text-xs text-gray-700 w-16 flex-none">
                        {DOC_TYPE_LABEL[doc.doc_type]}
                      </span>
                      <span className="text-xs text-gray-900 flex-1 truncate">
                        {doc.document_number ?? '番号未取得'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium flex-none ${badge.cls}`}
                      >
                        {doc.status === 'paid' && <CheckCircle className="w-3 h-3 mr-1" weight="fill" />}
                        {badge.label}
                      </span>
                      <span className="text-xs text-gray-700 tabular-nums w-24 text-right flex-none">
                        {yen(doc.total_amount == null ? null : Number(doc.total_amount))}
                      </span>
                      {doc.web_url && (
                        <a
                          href={doc.web_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-gray-700 transition-colors flex-none"
                          aria-label="連携先で開く"
                        >
                          <ArrowSquareOut className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
