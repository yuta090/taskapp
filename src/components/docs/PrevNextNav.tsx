import Link from 'next/link'
import { MANUAL_SECTIONS, getManualNavEntries, type ManualSection } from '@/lib/docs/manualNav'

interface NavEntry {
  slug: string[]
  label: string
}

/**
 * 前後リンクの並びは manualNav.ts（目次の真実源）から作る。
 * 各セクションの先頭は概要ページ（/docs/manual/<section>）。
 */
const navOrder: NavEntry[] = MANUAL_SECTIONS.flatMap((section: ManualSection) => [
  { slug: [section], label: '概要' },
  ...getManualNavEntries(section).map((entry) => ({
    slug: [section, entry.slug],
    label: entry.title,
  })),
])

function slugsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

interface PrevNextNavProps {
  currentSlug: string[]
}

export function PrevNextNav({ currentSlug }: PrevNextNavProps) {
  const currentSection = currentSlug[0]
  const sectionEntries = navOrder.filter((e) => e.slug[0] === currentSection)
  const currentIndex = sectionEntries.findIndex((e) =>
    slugsEqual(e.slug, currentSlug),
  )

  if (currentIndex === -1) return null

  const prev = currentIndex > 0 ? sectionEntries[currentIndex - 1] : null
  const next =
    currentIndex < sectionEntries.length - 1
      ? sectionEntries[currentIndex + 1]
      : null

  if (!prev && !next) return null

  return (
    <nav
      aria-label="前後のページ"
      className="flex justify-between border-t border-gray-200 pt-6 mt-12"
    >
      <div>
        {prev && (
          <Link
            href={`/docs/manual/${prev.slug.join('/')}`}
            className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
          >
            &larr; 前: {prev.label}
          </Link>
        )}
      </div>
      <div>
        {next && (
          <Link
            href={`/docs/manual/${next.slug.join('/')}`}
            className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
          >
            次: {next.label} &rarr;
          </Link>
        )}
      </div>
    </nav>
  )
}
