import { describe, it, expect, vi, beforeEach } from 'vitest'
import { guessMimeType, uploadFile, MAX_UPLOAD_BYTES, type UploadDeps } from './upload.js'

/**
 * `agentpm file upload` の中身（3段階アップロード）。
 *   1. file_upload_url でサーバーから署名URLをもらう
 *   2. 署名URLへ実バイトを PUT する（API サーバーを経由しない）
 *   3. file_upload_complete で完了を確定する
 * 途中で失敗したら、その先には進まない。
 */

describe('guessMimeType', () => {
  it('よく使う拡張子を MIME に変換する', () => {
    expect(guessMimeType('list.csv')).toBe('text/csv')
    expect(guessMimeType('LIST.CSV')).toBe('text/csv')
    expect(guessMimeType('data.tsv')).toBe('text/tab-separated-values')
    expect(guessMimeType('spec.pdf')).toBe('application/pdf')
    expect(guessMimeType('shot.png')).toBe('image/png')
    expect(guessMimeType('photo.jpg')).toBe('image/jpeg')
    expect(guessMimeType('book.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(guessMimeType('doc.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(guessMimeType('notes.md')).toBe('text/markdown')
    expect(guessMimeType('a.json')).toBe('application/json')
  })
  it('知らない拡張子・拡張子なしは application/octet-stream', () => {
    expect(guessMimeType('archive.xyz')).toBe('application/octet-stream')
    expect(guessMimeType('README')).toBe('application/octet-stream')
  })
})

describe('uploadFile', () => {
  const calls: { tool: string; params: Record<string, unknown> }[] = []
  const puts: { url: string; init: RequestInit }[] = []
  let putStatus = 200
  let deps: UploadDeps

  beforeEach(() => {
    calls.length = 0
    puts.length = 0
    putStatus = 200
    deps = {
      callTool: vi.fn(async (tool: string, params: Record<string, unknown>) => {
        calls.push({ tool, params })
        if (tool === 'file_upload_url') {
          return { fileId: 'f-1', signedUrl: 'https://storage.example/object/upload/sign/p?token=tok', token: 'tok', path: 'p', maxBytes: MAX_UPLOAD_BYTES }
        }
        return { ok: true, fileId: 'f-1', name: 'list.csv', downloadPath: '/api/files/f-1/download', tablePath: '/org/project/s/files/f-1', message: 'done' }
      }),
      fetch: vi.fn(async (url: string, init: RequestInit) => {
        puts.push({ url, init })
        return { ok: putStatus < 400, status: putStatus, text: async () => 'err body' } as Response
      }),
      readFile: vi.fn(async () => ({ bytes: Buffer.from('a,b\n1,2\n'), baseName: 'list.csv' })),
    }
  })

  it('署名URL取得 → PUT → 完了 の順で呼び、完了結果を返す', async () => {
    const result = await uploadFile(
      { filePath: '/tmp/list.csv', spaceId: 'space-1', tool: 'file_upload_url', completeTool: 'file_upload_complete' },
      deps,
    )

    expect(calls.map((c) => c.tool)).toEqual(['file_upload_url', 'file_upload_complete'])
    expect(calls[0].params).toEqual({ spaceId: 'space-1', name: 'list.csv', mimeType: 'text/csv', sizeBytes: 8 })
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toContain('token=tok')
    expect(puts[0].init.method).toBe('PUT')
    expect((puts[0].init.headers as Record<string, string>)['content-type']).toBe('text/csv')
    expect((puts[0].init.headers as Record<string, string>)['x-upsert']).toBe('false')
    expect(calls[1].params).toEqual({ spaceId: 'space-1', fileId: 'f-1' })
    expect(result).toMatchObject({ ok: true, fileId: 'f-1' })
  })

  it('--name / --mime-type で名前と種類を上書きできる', async () => {
    await uploadFile(
      { filePath: '/tmp/list.csv', spaceId: 'space-1', name: '営業先.csv', mimeType: 'text/plain', tool: 'file_upload_url', completeTool: 'file_upload_complete' },
      deps,
    )
    expect(calls[0].params).toMatchObject({ name: '営業先.csv', mimeType: 'text/plain' })
  })

  it('PUT が失敗したら完了を呼ばずにエラーにする', async () => {
    putStatus = 403
    await expect(
      uploadFile({ filePath: '/tmp/list.csv', spaceId: 'space-1', tool: 'file_upload_url', completeTool: 'file_upload_complete' }, deps),
    ).rejects.toThrow(/403/)
    expect(calls.map((c) => c.tool)).toEqual(['file_upload_url'])
  })

  it('50MB を超えるファイルはサーバーに聞く前に断る', async () => {
    deps.readFile = vi.fn(async () => ({ bytes: Buffer.alloc(0), baseName: 'big.zip', sizeBytes: MAX_UPLOAD_BYTES + 1 }))
    await expect(
      uploadFile({ filePath: '/tmp/big.zip', spaceId: 'space-1', tool: 'file_upload_url', completeTool: 'file_upload_complete' }, deps),
    ).rejects.toThrow(/50MB/)
    expect(calls).toHaveLength(0)
  })

  it('空のファイルは断る', async () => {
    deps.readFile = vi.fn(async () => ({ bytes: Buffer.alloc(0), baseName: 'empty.csv' }))
    await expect(
      uploadFile({ filePath: '/tmp/empty.csv', spaceId: 'space-1', tool: 'file_upload_url', completeTool: 'file_upload_complete' }, deps),
    ).rejects.toThrow(/空/)
    expect(calls).toHaveLength(0)
  })

  it('完了処理が失敗したら、やり直せるよう fileId をエラーに含める', async () => {
    deps.callTool = vi.fn(async (tool: string) => {
      if (tool === 'file_upload_url') return { fileId: 'f-1', signedUrl: 'https://s/x?token=t', token: 't', path: 'p' }
      throw new Error('Internal server error')
    })
    await expect(
      uploadFile({ filePath: '/tmp/list.csv', spaceId: 'space-1', tool: 'file_upload_url', completeTool: 'file_upload_complete' }, deps),
    ).rejects.toThrow(/f-1/)
  })
})
