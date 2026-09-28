'use client'

import { useCallback, useRef, useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

type ConfirmState = ConfirmOptions

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  // 返事を返して閉じる。参照が変わらないので、呼び出し側の useEffect の依存に
  // そのまま書ける（依存が毎回変わると、開いた直後に閉じる effect が走ってしまう）。
  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState(null)
  }, [])

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      // 前の問いかけが残っていたら「いいえ」で閉じてから開く（返事待ちを宙に浮かせない）
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setState(options)
    })
  }, [])

  const handleConfirm = useCallback(() => settle(true), [settle])
  const handleCancel = useCallback(() => settle(false), [settle])

  const ConfirmDialog = state ? (
    <ConfirmDialogUI
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel ?? '確認'}
      cancelLabel={state.cancelLabel ?? 'キャンセル'}
      variant={state.variant ?? 'default'}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null

  /** 人が答える前に、外の事情（見ている対象が変わった等）で問いかけを取り下げる。 */
  const closeConfirm = handleCancel

  return { confirm, ConfirmDialog, closeConfirm }
}

function ConfirmDialogUI({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  variant: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>({
    enabled: true,
    onClose: onCancel,
    skipAutoFocus: true,
  })

  // Auto-focus confirm button on mount
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      Object.assign(focusTrapRef, { current: node })
      if (node) {
        confirmRef.current?.focus()
      }
    },
    [focusTrapRef]
  )

  return (
    <div ref={setRef} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 animate-backdrop-in" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="relative w-full max-w-sm bg-surface rounded-xl shadow-xl p-5 animate-dialog-in"
      >
        <div className="flex items-start gap-3">
          <WarningCircle
            weight="fill"
            className={`text-2xl flex-shrink-0 mt-0.5 ${
              variant === 'danger' ? 'text-red-500' : 'text-amber-500'
            }`}
          />
          <div className="space-y-1">
            <h3 id="confirm-title" className="text-sm font-medium text-gray-900">
              {title}
            </h3>
            <p id="confirm-message" className="text-sm text-gray-500">
              {message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
