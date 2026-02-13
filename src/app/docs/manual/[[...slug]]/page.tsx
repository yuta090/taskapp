import { notFound } from 'next/navigation'
import { getManualPage, getAllManualSlugs } from '@/lib/markdown'
import { Breadcrumbs } from '@/components/docs/Breadcrumbs'
import { TableOfContents } from '@/components/docs/TableOfContents'
import { PrevNextNav } from '@/components/docs/PrevNextNav'
import { ManualLanding } from '@/components/docs/ManualLanding'
import { SectionIndex } from '@/components/docs/SectionIndex'

interface ManualPageProps {
  params: Promise<{ slug?: string[] }>
}

export async function generateStaticParams() {
  const slugs = await getAllManualSlugs()
  return slugs.map((slug) => ({
    slug: slug.length === 0 ? undefined : slug,
  }))
}

export async function generateMetadata({ params }: ManualPageProps) {
  const { slug } = await params
  const slugParts = slug ?? []
  const page = await getManualPage(slugParts)
  if (!page) return { title: 'ページが見つかりません | TaskApp' }
  return {
    title: `${page.title} | TaskApp マニュアル`,
  }
}

export default async function ManualPage({ params }: ManualPageProps) {
  const { slug } = await params
  const slugParts = slug ?? []

  // Landing page
  if (slugParts.length === 0) {
    return <ManualLanding />
  }

  // Section index pages
  if (slugParts.length === 1 && (slugParts[0] === 'internal' || slugParts[0] === 'client')) {
    const page = await getManualPage(slugParts)
    return <SectionIndex section={slugParts[0]} extraContent={page?.html} />
  }

  // Article pages
  const page = await getManualPage(slugParts)

  if (!page) {
    notFound()
  }

  const isLeafPage = !page.isIndex && slugParts.length > 0

  return (
    <article className="max-w-3xl mx-auto px-6 md:px-8 py-8 md:py-12">
      <Breadcrumbs slugParts={slugParts} pageTitle={page.title} />

      {isLeafPage && <TableOfContents html={page.html} />}

      <div
        className="prose prose-gray prose-sm max-w-none
          prose-headings:font-bold
          prose-h1:text-2xl prose-h1:mb-6 prose-h1:pb-3 prose-h1:border-b prose-h1:border-gray-200
          prose-h2:text-lg prose-h2:mt-10 prose-h2:mb-4
          prose-h3:text-base prose-h3:mt-8 prose-h3:mb-3
          prose-table:text-sm
          prose-th:bg-gray-50 prose-th:px-3 prose-th:py-2
          prose-td:px-3 prose-td:py-2
          prose-code:text-indigo-600 prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
          prose-pre:bg-gray-900 prose-pre:text-gray-100
          prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
          prose-blockquote:border-indigo-300 prose-blockquote:text-gray-600
          prose-hr:border-gray-200
          prose-li:marker:text-gray-400"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />

      {isLeafPage && <PrevNextNav currentSlug={slugParts} />}
    </article>
  )
}
