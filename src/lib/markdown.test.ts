import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs/promises'
import { getManualPage, getAllManualSlugs } from './markdown'

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
  },
}))

const mockedFs = vi.mocked(fs, true)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getManualPage', () => {
  describe('path resolution', () => {
    it('reads docs/manual/index.md directly when slugParts is empty (no access() check needed)', async () => {
      mockedFs.readFile.mockResolvedValue('# トップ\n\nようこそ')

      const page = await getManualPage([])

      expect(page).not.toBeNull()
      expect(page?.isIndex).toBe(true)
      expect(page?.title).toBe('トップ')
      expect(mockedFs.access).not.toHaveBeenCalled()
    })

    it('uses the exact "<slug>.md" file when it exists', async () => {
      mockedFs.access.mockResolvedValueOnce(undefined) // exactPath exists
      mockedFs.readFile.mockResolvedValue('# タスク\n\n本文')

      const page = await getManualPage(['internal', 'tasks'])

      expect(page).not.toBeNull()
      expect(page?.isIndex).toBe(false)
      expect(mockedFs.readFile.mock.calls[0][0]).toMatch(/tasks\.md$/)
    })

    it('falls back to "<slug>/index.md" when the exact file does not exist', async () => {
      mockedFs.access
        .mockRejectedValueOnce(new Error('ENOENT')) // exactPath missing
        .mockResolvedValueOnce(undefined) // indexPath exists
      mockedFs.readFile.mockResolvedValue('# 内部向け\n\n本文')

      const page = await getManualPage(['internal'])

      expect(page).not.toBeNull()
      expect(page?.isIndex).toBe(true)
      expect(mockedFs.readFile.mock.calls[0][0]).toMatch(/internal[/\\]index\.md$/)
    })

    it('returns null when neither the exact file nor its index.md exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT'))

      const page = await getManualPage(['nonexistent'])

      expect(page).toBeNull()
      expect(mockedFs.readFile).not.toHaveBeenCalled()
    })

    it('returns null and never reads the file when the resolved path escapes docs/manual (traversal guard)', async () => {
      mockedFs.access.mockResolvedValue(undefined) // pretend every access() succeeds

      const page = await getManualPage(['..', '..', '..', 'etc', 'passwd'])

      expect(page).toBeNull()
      expect(mockedFs.readFile).not.toHaveBeenCalled()
    })
  })

  describe('title extraction', () => {
    it('extracts the title from the first "# " heading', async () => {
      mockedFs.readFile.mockResolvedValue('intro text\n\n# 実際の見出し\n\n本文')

      const page = await getManualPage([])

      expect(page?.title).toBe('実際の見出し')
    })

    it('falls back to the default title when there is no "# " heading', async () => {
      mockedFs.readFile.mockResolvedValue('見出しなしの本文だけ')

      const page = await getManualPage([])

      expect(page?.title).toBe('AgentPM マニュアル')
    })
  })

  describe('sanitization (XSS)', () => {
    it('does not render a raw <script> tag or its contents', async () => {
      mockedFs.readFile.mockResolvedValue(
        '# タイトル\n\n<script>alert(document.cookie)</script>\n\n安全な本文'
      )

      const page = await getManualPage([])

      expect(page?.html).not.toContain('<script')
      expect(page?.html).not.toContain('alert(document.cookie)')
      expect(page?.html).toContain('安全な本文')
    })

    it('strips an onerror handler from a raw <img> tag', async () => {
      mockedFs.readFile.mockResolvedValue(
        '# タイトル\n\n<img src="x" onerror="alert(1)">\n\n安全な本文'
      )

      const page = await getManualPage([])

      expect(page?.html?.toLowerCase()).not.toContain('onerror')
      expect(page?.html).not.toContain('alert(1)')
    })

    it('strips a javascript: URL from a markdown link', async () => {
      mockedFs.readFile.mockResolvedValue('# タイトル\n\n[クリック](javascript:alert(1))')

      const page = await getManualPage([])

      expect(page?.html).not.toContain('javascript:')
    })

    it('keeps a normal https link intact', async () => {
      mockedFs.readFile.mockResolvedValue('# タイトル\n\n[公式サイト](https://example.com/docs)')

      const page = await getManualPage([])

      expect(page?.html).toContain('href="https://example.com/docs"')
    })

    it('still renders safe GFM + heading-anchor content through the sanitize schema', async () => {
      mockedFs.readFile.mockResolvedValue(
        '# ガイド\n\n## セクションA\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
      )

      const page = await getManualPage([])

      // rehype-slug assigns an id to headings; the custom schema explicitly
      // allows `id` (and `className`) on top of the sanitize defaults.
      expect(page?.html).toMatch(/<h2[^>]*id="[^"]+"/)
      expect(page?.html).toContain('<table>')
    })
  })

  describe('relative link rewriting', () => {
    it('rewrites a "./sibling.md" link relative to the current (non-index) page directory', async () => {
      mockedFs.access.mockResolvedValueOnce(undefined)
      mockedFs.readFile.mockResolvedValue('# タスク\n\n[ミーティング](./meetings.md)')

      const page = await getManualPage(['internal', 'tasks'])

      expect(page?.html).toContain('href="/docs/manual/internal/meetings"')
    })

    it('rewrites a "../index.md" link by popping up one directory', async () => {
      mockedFs.access.mockResolvedValueOnce(undefined)
      mockedFs.readFile.mockResolvedValue('# タスク\n\n[トップへ](../index.md)')

      const page = await getManualPage(['internal', 'tasks'])

      expect(page?.html).toContain('href="/docs/manual"')
    })

    it('resolves relative links from the index page\'s own directory when isIndex is true', async () => {
      mockedFs.access
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(undefined)
      mockedFs.readFile.mockResolvedValue('# 内部向け\n\n[タスク](./tasks.md)')

      const page = await getManualPage(['internal'])

      expect(page?.isIndex).toBe(true)
      expect(page?.html).toContain('href="/docs/manual/internal/tasks"')
    })

    it('leaves absolute (non-relative) links untouched', async () => {
      mockedFs.readFile.mockResolvedValue('# タイトル\n\n[外部](https://example.com/x)')

      const page = await getManualPage([])

      expect(page?.html).toContain('href="https://example.com/x"')
    })
  })
})

describe('getAllManualSlugs', () => {
  it('returns a non-empty, statically defined list of slug paths', async () => {
    const slugs = await getAllManualSlugs()

    expect(slugs.length).toBeGreaterThan(0)
    expect(slugs).toContainEqual([])
    expect(slugs).toContainEqual(['internal', 'tasks'])
    expect(slugs).toContainEqual(['client', 'getting-started'])
  })
})
