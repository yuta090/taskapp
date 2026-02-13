import Link from 'next/link'

const sectionNames: Record<string, string> = {
  internal: '開発会社向け',
  client: 'クライアント向け',
}

interface BreadcrumbsProps {
  slugParts: string[]
  pageTitle: string
}

export function Breadcrumbs({ slugParts, pageTitle }: BreadcrumbsProps) {
  const crumbs: { label: string; href?: string }[] = [
    { label: 'マニュアル', href: '/docs/manual' },
  ]

  if (slugParts.length > 0) {
    const section = slugParts[0]
    const sectionLabel = sectionNames[section] ?? section
    if (slugParts.length === 1) {
      crumbs.push({ label: sectionLabel })
    } else {
      crumbs.push({ label: sectionLabel, href: `/docs/manual/${section}` })
      crumbs.push({ label: pageTitle })
    }
  }

  return (
    <nav aria-label="パンくずリスト" className="text-sm text-gray-500 mb-4">
      <ol className="flex items-center gap-1.5 flex-wrap">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">/</span>}
              {isLast || !crumb.href ? (
                <span className={isLast ? 'text-gray-900 font-medium' : ''}>
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-indigo-600 transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
