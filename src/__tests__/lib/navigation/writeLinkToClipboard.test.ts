import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeLinkToClipboard } from '@/lib/navigation/writeLinkToClipboard'

const payload = { plain: 'ページ §見出し\nhttps://x.test/#a', html: '<a href="https://x.test/#a">ページ §見出し</a>' }

/** jsdom の Blob には text() が無いので FileReader で読む */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsText(blob)
  })
}

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
}

afterEach(() => {
  vi.unstubAllGlobals()
  stubClipboard(undefined)
})

describe('writeLinkToClipboard', () => {
  it('ClipboardItem が使えるときは text/plain と text/html の2つを1回で入れる', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    stubClipboard({ write, writeText })
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    await expect(writeLinkToClipboard(payload)).resolves.toBe(true)

    expect(write).toHaveBeenCalledTimes(1)
    const item = write.mock.calls[0][0][0] as FakeClipboardItem
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain'])
    expect(item.items['text/html'].type).toBe('text/html')
    expect(await readBlob(item.items['text/plain'])).toBe(payload.plain)
    expect(await readBlob(item.items['text/html'])).toBe(payload.html)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('ClipboardItem が無いブラウザでは文字だけを入れる', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    vi.stubGlobal('ClipboardItem', undefined)

    await expect(writeLinkToClipboard(payload)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(payload.plain)
  })

  it('2形式の書き込みが断られたら、文字だけで入れ直す', async () => {
    const write = vi.fn().mockRejectedValue(new Error('NotAllowed'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ write, writeText })
    vi.stubGlobal('ClipboardItem', class {
      constructor(public items: Record<string, Blob>) {}
    })

    await expect(writeLinkToClipboard(payload)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(payload.plain)
  })

  it('どちらも失敗したら false（例外は投げない）', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    vi.stubGlobal('ClipboardItem', undefined)
    await expect(writeLinkToClipboard(payload)).resolves.toBe(false)
  })

  it('クリップボード自体が無ければ false', async () => {
    stubClipboard(undefined)
    await expect(writeLinkToClipboard(payload)).resolves.toBe(false)
  })
})
