'use client'

import { useId, useState, type ReactNode } from 'react'
import { CaretDown, CaretRight, Plus, QrCode } from '@phosphor-icons/react'

export type ConnectKind = 'self' | 'counterparty' | 'group'
export type ConnectState = 'loading' | 'preparing' | 'ready' | 'codeIssued' | 'connected' | 'disabled'

interface ConnectionFlowSectionProps {
  kind: ConnectKind
  state: ConnectState
  /** 接続済み等のステータス要約バナー。常に最上部に出す。 */
  summary?: ReactNode
  /** QR＋手順ブロック（LineFriendQr等）。状態により畳まれる。 */
  qr?: ReactNode
  /** 主アクション（コード発行ボタン/発行済みコード）。手順から切り離さない。 */
  action?: ReactNode
  /** 接続済み時に常時見せたい詳細（連携済み一覧・管理導線など）。 */
  detail?: ReactNode
  /** エラー表示。 */
  error?: ReactNode
  /**
   * QRを畳んだ状態(counterparty接続済み)でも、アクションの直前に出す短い手順リマインド。
   * 「友だち追加だけで連携できる」誤解を防ぐため、コード発行ボタン単体を出さない。
   */
  stepsHint?: ReactNode
  /**
   * 未接続でもQRだけ畳む。同じページの別カードですでにQRを見せている場合に使う
   * （同一Botの同じQRが1画面に2つ出ると、それだけで認知負荷が倍になる）。
   */
  collapseQr?: boolean
}

/**
 * 接続フローの状態別表示を一元化する提示シェル（PR2）。
 *
 * 「状態ごとに何を展開/折りたたむか」を種別(kind)×状態(state)のマトリクスで一箇所に集約する。
 * バックエンド/API/identityは扱わない純粋な表示レイヤー。各パネルはスロット(summary/qr/
 * action/detail)と(kind,state)を渡すだけ。
 *
 * 折りたたみ方針（codex/fable合意）:
 * - self + connected      : QR＋アクションを「別の端末をつなぐ」ボタンに畳む（1回接続が基本）
 * - counterparty + connected: QRのみ「QRを表示」に畳む。アクションと手順リマインドは常時表示（追加接続が通常）
 * - group                 : 自動では畳まない（反復追加が通常なので毎回のクリックを増やさない）
 * - それ以外(未接続/発行済み等) : すべて展開（オンボーディング）
 */
type DisplayMode = 'loading' | 'expanded' | 'collapse-onboarding' | 'collapse-qr'

function resolveMode(kind: ConnectKind, state: ConnectState, collapseQr = false): DisplayMode {
  if (state !== 'connected') return collapseQr ? 'collapse-qr' : 'expanded'
  if (kind === 'self') return 'collapse-onboarding'
  if (kind === 'counterparty') return 'collapse-qr'
  return 'expanded' // group: 接続済みでも展開のまま
}

function Disclosure({
  label,
  icon,
  children,
  testId,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`${testId}-toggle`}
        className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        {open ? <CaretDown className="h-3.5 w-3.5" /> : <CaretRight className="h-3.5 w-3.5" />}
        {icon}
        {label}
      </button>
      {open && (
        <div id={panelId} data-testid={`${testId}-panel`} className="mt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

export function ConnectionFlowSection({
  kind,
  state,
  summary,
  qr,
  action,
  detail,
  error,
  stepsHint,
  collapseQr,
}: ConnectionFlowSectionProps) {
  // loading中は接続済みか未接続かがまだ確定しないため、QR/アクションを出さない
  // （出すと接続済みの相手先で「展開→畳む」のちらつき＋レイアウトシフトが起きる）。
  const mode = state === 'loading' ? 'loading' : resolveMode(kind, state, collapseQr)

  return (
    <div className="space-y-4" data-testid="connection-flow-section" data-kind={kind} data-state={state} data-mode={mode}>
      {error}
      {summary}

      {mode === 'loading' && (
        <div data-testid="connect-flow-skeleton" className="space-y-2" aria-busy="true">
          <div className="h-24 w-24 rounded bg-gray-100 animate-pulse" />
          <div className="h-4 w-40 rounded bg-gray-100 animate-pulse" />
        </div>
      )}

      {mode === 'expanded' && (
        <>
          {qr}
          {action}
          {detail}
        </>
      )}

      {mode === 'collapse-onboarding' && (
        <>
          {detail}
          <Disclosure
            label="別の端末をつなぐ"
            icon={<Plus className="h-3.5 w-3.5" />}
            testId="connect-reopen"
          >
            {qr}
            {action}
          </Disclosure>
        </>
      )}

      {mode === 'collapse-qr' && (
        <>
          {/* 主アクションを最初に。連携済み一覧は「済んだこと」なので後ろに置く。 */}
          {stepsHint}
          {action}
          <Disclosure label="QRを表示" icon={<QrCode className="h-3.5 w-3.5" />} testId="connect-showqr">
            {qr}
          </Disclosure>
          {detail}
        </>
      )}
    </div>
  )
}
