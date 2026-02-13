interface TableOfContentsProps {
  html: string
}

interface Heading {
  id: string
  text: string
}

function extractH2Headings(html: string): Heading[] {
  const headings: Heading[] = []
  const regex = /<h2[^>]*\bid="([^"]+)"[^>]*>(.*?)<\/h2>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, '')
    headings.push({ id: match[1], text })
  }
  return headings
}

export function TableOfContents({ html }: TableOfContentsProps) {
  const headings = extractH2Headings(html)

  if (headings.length < 2) return null

  return (
    <nav
      aria-label="目次"
      className="bg-gray-50 rounded-lg p-4 mb-8 not-prose"
    >
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        目次
      </p>
      <ul className="space-y-1.5">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
