import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import fs from 'fs/promises'
import path from 'path'

const MANUAL_DIR = path.join(process.cwd(), 'docs', 'manual')

export async function getManualPage(slugParts: string[]): Promise<{
  html: string
  title: string
  isIndex: boolean
} | null> {
  let filePath: string
  let isIndex = false

  if (slugParts.length === 0) {
    filePath = path.join(MANUAL_DIR, 'index.md')
    isIndex = true
  } else {
    const exactPath = path.join(MANUAL_DIR, ...slugParts) + '.md'
    const indexPath = path.join(MANUAL_DIR, ...slugParts, 'index.md')

    try {
      await fs.access(exactPath)
      filePath = exactPath
    } catch {
      try {
        await fs.access(indexPath)
        filePath = indexPath
        isIndex = true
      } catch {
        return null
      }
    }
  }

  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(MANUAL_DIR))) {
    return null
  }

  const raw = await fs.readFile(filePath, 'utf-8')

  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : 'TaskApp マニュアル'

  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(raw)

  let html = String(result)
  html = rewriteLinks(html, slugParts, isIndex)

  return { html, title, isIndex }
}

function rewriteLinks(html: string, currentSlugParts: string[], isIndex: boolean): string {
  const basePath = '/docs/manual'
  const currentDir = isIndex ? [...currentSlugParts] : currentSlugParts.slice(0, -1)

  return html.replace(
    /href="(\.\.?\/[^"]+)"/g,
    (_match, relativeHref: string) => {
      const cleaned = relativeHref
        .replace(/\.md$/, '')
        .replace(/\/index$/, '')
        .replace(/\/$/, '')

      const parts = [...currentDir]
      for (const segment of cleaned.split('/')) {
        if (segment === '..') {
          parts.pop()
        } else if (segment !== '.' && segment !== '') {
          parts.push(segment)
        }
      }

      const resolvedPath = parts.length > 0
        ? `${basePath}/${parts.join('/')}`
        : basePath

      return `href="${resolvedPath}"`
    }
  )
}

export async function getAllManualSlugs(): Promise<string[][]> {
  return [
    [],
    ['internal'],
    ['internal', 'getting-started'],
    ['internal', 'tasks'],
    ['internal', 'meetings'],
    ['internal', 'wiki'],
    ['internal', 'reviews'],
    ['internal', 'scheduling'],
    ['internal', 'settings'],
    ['internal', 'mcp-guide'],
    ['internal', 'notifications'],
    ['internal', 'troubleshooting'],
    ['internal', 'glossary'],
    ['client'],
    ['client', 'getting-started'],
    ['client', 'dashboard'],
    ['client', 'tasks'],
    ['client', 'meetings'],
    ['client', 'approvals'],
    ['client', 'troubleshooting'],
  ]
}
