'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { CheckCircle, Warning, SpinnerGap, ArrowRight } from '@phosphor-icons/react'
import { APPROVE_BUTTON } from '@/lib/design/tokens'

interface TaskData {
  id: string
  title: string
  description: string | null
  status: string
  ball: string
  estimateStatus: string
  estimatedCost: number | null
}

interface TokenData {
  task: TaskData
  actionType: 'approve' | 'estimate_approve'
  spaceName: string
  orgName: string
  canExecute: boolean
}

type PageState = 'loading' | 'ready' | 'processing' | 'success' | 'error' | 'expired'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount)
}

export function EmailActionClient({ token }: { token: string }) {
  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<TokenData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`/api/portal/email-action/${token}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setErrorMessage(body.error || 'リンクが無効です')
          setState(res.status === 410 ? 'expired' : 'error')
          return
        }
        const json = await res.json()
        setData(json)
        setState('ready')
      } catch {
        setErrorMessage('ネットワークエラーが発生しました')
        setState('error')
      }
    }
    validate()
  }, [token])

  const handleApprove = useCallback(async () => {
    setState('processing')
    try {
      const res = await fetch(`/api/portal/email-action/${token}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErrorMessage(body.error || '承認に失敗しました')
        setState('error')
        return
      }

      setSuccessMessage(body.message || '承認しました')
      setState('success')
    } catch {
      setErrorMessage('ネットワークエラーが発生しました')
      setState('error')
    }
  }, [token])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg text-white text-sm font-bold shadow-md mb-3">
            TA
          </div>
          <div className="text-sm text-gray-500">
            {data?.orgName && `${data.orgName} / `}{data?.spaceName || 'TaskApp'}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {state === 'loading' && <LoadingView />}
          {state === 'ready' && data && (
            <ReadyView data={data} onApprove={handleApprove} />
          )}
          {state === 'processing' && <ProcessingView />}
          {state === 'success' && <SuccessView message={successMessage} />}
          {state === 'error' && <ErrorView message={errorMessage} />}
          {state === 'expired' && <ExpiredView message={errorMessage} />}
        </div>

        {/* Portal link */}
        <div className="text-center mt-4">
          <Link
            href="/portal"
            className="text-sm text-gray-500 hover:text-amber-600 transition-colors inline-flex items-center gap-1"
          >
            ポータルを開く
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}

function LoadingView() {
  return (
    <div className="p-8 text-center">
      <SpinnerGap size={32} className="animate-spin text-amber-500 mx-auto mb-3" />
      <p className="text-gray-600">読み込み中...</p>
    </div>
  )
}

function ReadyView({ data, onApprove }: { data: TokenData; onApprove: () => void }) {
  const isEstimate = data.actionType === 'estimate_approve'

  if (!data.canExecute) {
    return (
      <div className="p-6">
        <div className="text-center mb-4">
          <Warning size={40} className="text-amber-500 mx-auto mb-2" />
          <h2 className="text-lg font-bold text-gray-900">状態が変更されました</h2>
        </div>
        <p className="text-sm text-gray-600 text-center mb-4">
          このタスクは既に対応済みか、状態が変更されています。
        </p>
        <TaskCard title={data.task.title} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">
        {isEstimate ? '見積もりの確認' : '確認のお願い'}
      </h2>

      {/* Task info */}
      <TaskCard title={data.task.title} />

      {/* Estimate amount */}
      {isEstimate && data.task.estimatedCost && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-xs font-semibold text-amber-700 mb-1">見積もり金額</div>
          <div className="text-2xl font-bold text-amber-900">
            {formatCurrency(data.task.estimatedCost)}
          </div>
        </div>
      )}

      {/* Approve button */}
      <button
        type="button"
        onClick={onApprove}
        className={`w-full py-3 px-4 ${APPROVE_BUTTON.solid} font-bold rounded-xl transition-colors text-base shadow-sm`}
      >
        {isEstimate ? '見積もりを承認する' : '承認する'}
      </button>

      <p className="text-xs text-gray-400 text-center mt-3">
        差し戻しやコメントは
        <Link href="/portal" className="text-amber-600 hover:underline">ポータル</Link>
        から行えます
      </p>
    </div>
  )
}

function ProcessingView() {
  return (
    <div className="p-8 text-center">
      <SpinnerGap size={32} className="animate-spin text-amber-500 mx-auto mb-3" />
      <p className="text-gray-600 font-medium">処理中...</p>
    </div>
  )
}

function SuccessView({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <CheckCircle size={48} weight="fill" className="text-emerald-500 mx-auto mb-3" />
      <h2 className="text-lg font-bold text-gray-900 mb-1">{message}</h2>
      <p className="text-sm text-gray-500">ありがとうございます。チームに通知されました。</p>
    </div>
  )
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <Warning size={48} weight="fill" className="text-rose-500 mx-auto mb-3" />
      <h2 className="text-lg font-bold text-gray-900 mb-1">エラー</h2>
      <p className="text-sm text-gray-600 mb-4">{message}</p>
      <Link
        href="/portal"
        className="inline-flex items-center gap-1 text-sm text-amber-600 hover:underline font-medium"
      >
        ポータルから操作する
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}

function ExpiredView({ message }: { message: string }) {
  return (
    <div className="p-8 text-center">
      <Warning size={48} weight="fill" className="text-amber-500 mx-auto mb-3" />
      <h2 className="text-lg font-bold text-gray-900 mb-1">リンク無効</h2>
      <p className="text-sm text-gray-600 mb-4">{message}</p>
      <Link
        href="/portal"
        className="inline-flex items-center gap-1 text-sm text-amber-600 hover:underline font-medium"
      >
        ポータルからログインして操作する
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}

function TaskCard({ title }: { title: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
      <div className="text-xs font-semibold text-gray-500 mb-1">タスク</div>
      <div className="text-base font-bold text-gray-900">{title}</div>
    </div>
  )
}
