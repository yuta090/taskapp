import Link from 'next/link'

interface CategoryCardProps {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  badge?: string
}

export function CategoryCard({ href, icon, title, description, badge }: CategoryCardProps) {
  return (
    <Link
      href={href}
      className="block border border-gray-200 rounded-lg p-5 hover:shadow-md hover:border-indigo-200 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="text-gray-400 group-hover:text-indigo-500 transition-colors mt-0.5">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            {badge && (
              <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
      </div>
    </Link>
  )
}
