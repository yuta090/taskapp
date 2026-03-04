const VARIANTS: Record<string, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
}

interface AdminBadgeProps {
  children: React.ReactNode
  variant?: keyof typeof VARIANTS
}

export function AdminBadge({ children, variant = 'default' }: AdminBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${VARIANTS[variant]}`}>
      {children}
    </span>
  )
}
