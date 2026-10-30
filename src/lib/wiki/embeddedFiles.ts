/**
 * Wiki の本文（BlockNote の JSON）から、画像・ファイルのブロックに上げたファイルの id を拾う。
 *
 * 相手先に公開するとき、中の画像も相手先に見えるようにするために使う。
 * 文中のリンク（「ファイルへのリンク」）は拾わない。リンクは既にあるファイルを指すだけで、
 * 社内のままにしておきたいファイルのことがあるため。
 */
const EMBED_BLOCK_TYPES = new Set(['image', 'file'])
const FILE_URL = /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/i

interface BlockLike {
  type?: unknown
  props?: { url?: unknown }
  children?: unknown
}

export function extractEmbeddedFileIds(body: string | null | undefined): string[] {
  if (!body) return []
  let blocks: unknown
  try {
    blocks = JSON.parse(body)
  } catch {
    return []
  }
  const ids = new Set<string>()
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const block of list as BlockLike[]) {
      if (typeof block?.type === 'string' && EMBED_BLOCK_TYPES.has(block.type)) {
        const url = block.props?.url
        const match = typeof url === 'string' ? FILE_URL.exec(url) : null
        if (match) ids.add(match[1].toLowerCase())
      }
      walk(block?.children)
    }
  }
  walk(blocks)
  return [...ids]
}
