import { NextRequest, NextResponse } from 'next/server'
import { verifySuperadmin } from '@/lib/admin/verify-superadmin'
import { renderMarkdownToHtml, splitOnCtaPlaceholder } from '@/lib/markdown'

export const runtime = 'nodejs'

/**
 * 管理エディタのライブプレビュー。公開ページと同じサニタイズ済みパイプラインで
 * レンダリングするため、プレビュー = 本番の見た目になる。
 */
export async function POST(request: NextRequest) {
  if (!(await verifySuperadmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const md = typeof body?.body_md === 'string' ? body.body_md : ''
  const { before, after, hasPlaceholder } = splitOnCtaPlaceholder(md)
  const [beforeHtml, afterHtml] = await Promise.all([
    renderMarkdownToHtml(before),
    hasPlaceholder ? renderMarkdownToHtml(after) : Promise.resolve(''),
  ])
  return NextResponse.json({ beforeHtml, afterHtml, hasPlaceholder })
}
