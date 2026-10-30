import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadToSignedUrl = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}))

import { uploadSpaceFile } from '@/lib/hooks/useFiles'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  uploadToSignedUrl.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('uploadSpaceFile', () => {
  it('署名URLへ上げて完了を知らせ、作ったファイルの id を返す（Wiki の画像はこの id で URL を作る）', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'f-1', token: 't', path: 's/f-1/a.png' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    uploadToSignedUrl.mockResolvedValue({ error: null })
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    await expect(uploadSpaceFile('space-1', file)).resolves.toEqual({ fileId: 'f-1' })
    expect(uploadToSignedUrl).toHaveBeenCalledWith('s/f-1/a.png', 't', file)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/files/f-1/complete', { method: 'POST' })
  })

  it('完了の通知が失敗したら、その理由で止まる', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'f-1', token: 't', path: 'p' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'アップロードが完了していません' }), { status: 400 }))
    uploadToSignedUrl.mockResolvedValue({ error: null })

    await expect(uploadSpaceFile('space-1', new File(['x'], 'a.png'))).rejects.toThrow('アップロードが完了していません')
  })
})
