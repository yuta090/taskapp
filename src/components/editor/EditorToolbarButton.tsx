'use client'

/**
 * 文書エディタ（Wiki・議事録）の本文の下に並ぶ差し込みボタン。
 * 見た目を1か所に集めて、2つのエディタでボタンの大きさや色がずれないようにする。
 * 絵文字は使わない（日本語の業務文書の見た目に合わせる）。
 */
export function EditorToolbarButton({
  icon,
  label,
  onClick,
  ...rest
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'type'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
    >
      <span className="text-sm">{icon}</span>
      {label}
    </button>
  )
}
