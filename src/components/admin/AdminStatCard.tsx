import Link from 'next/link'
import { ArrowUp, ArrowDown } from '@phosphor-icons/react/dist/ssr'

interface AdminStatCardProps {
  label: string
  value: string | number
  sub?: string
  href?: string
  trend?: { value: number; label: string }
}

export function AdminStatCard({ label, value, sub, href, trend }: AdminStatCardProps) {
  const content = (
    <>
      <p className="text-sm text-gray-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {trend && trend.value !== 0 && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              trend.value > 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {trend.value > 0 ? (
              <ArrowUp size={12} weight="bold" />
            ) : (
              <ArrowDown size={12} weight="bold" />
            )}
            {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {(sub ?? trend?.label) && (
        <p className="mt-1 text-xs text-gray-400">{sub ?? trend?.label}</p>
      )}
    </>
  )

  const className = `bg-white rounded-xl border border-gray-200 p-5 ${
    href ? 'hover:border-indigo-300 hover:shadow-sm transition-all' : ''
  }`

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}
