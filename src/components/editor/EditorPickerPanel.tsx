'use client'

/**
 * 文書エディタ（Wiki・議事録）が本文の下に出す選択パネルの枠。
 *
 * モーダル禁止の UI ルールに従い、呼び出し側がインラインパネルとして絶対配置する。
 * 枠の見た目（幅・高さの上限・スクロール・影）は、どのピッカーでも揃える。
 */
export function EditorPickerPanel({
  children,
  maxHeight,
  ...rest
}: {
  children: React.ReactNode
  /** 画面に入る高さ。呼び出し側が上下の空きを測って渡す */
  maxHeight?: number
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{ maxHeight: maxHeight ?? 320, ...rest.style }}
      className="flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-surface p-2 shadow-lg"
    >
      {children}
    </div>
  )
}
