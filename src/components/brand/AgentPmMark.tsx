/**
 * AgentPM ブランドマーク — 「ボールの受け渡し」。
 *
 * 塗りつぶした棒2本（社内 / 相手先）と、その真ん中のボール1個で
 * 「いまボールがどちらにあるか」というプロダクトの根幹概念を表す。
 *
 * 線（stroke）ではなく面（fill）で組むのは意匠ではなく要件で、
 * 16px（favicon・LINEのアイコン・モバイルヘッダ）まで縮めても
 * 棒が約2.5px・ボールが約3.3px残り、輪郭が消えないため。
 * 形の条件（3要素・文字なし・面で構成）は AgentPmMark.test.tsx で固定している。
 *
 * 色は currentColor。amber バッジの中に置くときは text-brand-ink を当てる
 * （amber 地に白文字はコントラストが約2.1しかなく小さいと輪郭がぼやけるため、
 * 約8確保できる濃い墨を使う）。brand-ink はダークでも反転しない固定トークン。
 */
export function AgentPmMark({
  size = 24,
  className = 'text-brand-ink',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <rect x="3.6" y="6" width="3.8" height="12" rx="1.9" fill="currentColor" />
      <rect x="16.6" y="6" width="3.8" height="12" rx="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}
