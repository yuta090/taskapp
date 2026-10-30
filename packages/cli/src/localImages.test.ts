import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { uploadLocalImages } from './localImages.js'

const BASE = '/work/docs'

function setup(existing: string[], failOn?: string) {
  const set = new Set(existing)
  const upload = vi.fn(async (abs: string) => {
    if (abs === failOn) throw new Error('boom')
    return `/api/files/${abs.split('/').pop()}/download`
  })
  const exists = (abs: string) => set.has(abs)
  return { upload, exists }
}

describe('uploadLocalImages', () => {
  it('Markdown の相対パス画像を上げて downloadPath に差し替える', async () => {
    const { upload, exists } = setup([resolve(BASE, 'img/a.png')])
    const r = await uploadLocalImages('# T\n\n![図](img/a.png)\n', BASE, upload, exists)
    expect(upload).toHaveBeenCalledWith(resolve(BASE, 'img/a.png'))
    expect(r.text).toBe('# T\n\n![図](/api/files/a.png/download)\n')
    expect(r.uploaded).toEqual([{ path: resolve(BASE, 'img/a.png'), url: '/api/files/a.png/download' }])
  })

  it('画像の拡張子でないファイルは上げない（本文に書かれた鍵などを持ち出さない）', async () => {
    const { upload, exists } = setup(['/home/u/.ssh/id_rsa', resolve(BASE, 'notes.txt'), resolve(BASE, 'b.JPG')])
    const r = await uploadLocalImages('![](/home/u/.ssh/id_rsa) <img src="notes.txt"> ![](b.JPG)', BASE, upload, exists)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledWith(resolve(BASE, 'b.JPG'))
    expect(r.text).toBe('![](/home/u/.ssh/id_rsa) <img src="notes.txt"> ![](/api/files/b.JPG/download)')
  })

  it('/ 始まりはファイルシステムの絶対パスとして扱う', async () => {
    const { upload, exists } = setup(['/abs/x.png'])
    const r = await uploadLocalImages('![x](/abs/x.png)', BASE, upload, exists)
    expect(r.text).toBe('![x](/api/files/x.png/download)')
  })

  it('スキーム付き・// 始まり・/api/ 始まりは触らない', async () => {
    const { upload, exists } = setup([])
    const text = '![a](https://e.com/a.png)\n![b](data:image/png;base64,AAAA)\n![c](//cdn/c.png)\n![d](/api/files/1/download)\n'
    const r = await uploadLocalImages(text, BASE, upload, exists)
    expect(r.text).toBe(text)
    expect(upload).not.toHaveBeenCalled()
  })

  it('存在しないファイルはそのまま残す', async () => {
    const { upload, exists } = setup([])
    const text = '![a](missing.png)'
    const r = await uploadLocalImages(text, BASE, upload, exists)
    expect(r.text).toBe(text)
    expect(r.uploaded).toEqual([])
  })

  it('同じファイルは1回だけ上げて全部差し替える', async () => {
    const { upload, exists } = setup([resolve(BASE, 'a.png')])
    const r = await uploadLocalImages('![1](a.png)\n![2](./a.png)\n<img src="a.png">', BASE, upload, exists)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(r.text).toBe('![1](/api/files/a.png/download)\n![2](/api/files/a.png/download)\n<img src="/api/files/a.png/download">')
    expect(r.uploaded).toHaveLength(1)
  })

  it('コードブロックとインラインコードの中は触らない', async () => {
    const { upload, exists } = setup([resolve(BASE, 'a.png')])
    const text = '```md\n![x](a.png)\n```\n\n`![y](a.png)` と ![z](a.png)\n'
    const r = await uploadLocalImages(text, BASE, upload, exists)
    expect(r.text).toBe('```md\n![x](a.png)\n```\n\n`![y](a.png)` と ![z](/api/files/a.png/download)\n')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('title 付き・山括弧・%20 を解釈する', async () => {
    const { upload, exists } = setup([resolve(BASE, 'a.png'), resolve(BASE, 'my pic.png'), resolve(BASE, 'b c.png')])
    const text = '![a](a.png "タイトル")\n![b](<my pic.png>)\n![c](b%20c.png)'
    const r = await uploadLocalImages(text, BASE, upload, exists)
    expect(r.text).toBe(
      '![a](/api/files/a.png/download "タイトル")\n![b](</api/files/my pic.png/download>)\n![c](/api/files/b c.png/download)',
    )
    expect(upload).toHaveBeenCalledTimes(3)
  })

  it('HTML の img（シングル・ダブルクォート）を差し替える', async () => {
    const { upload, exists } = setup([resolve(BASE, 'a.png'), resolve(BASE, 'b.png')])
    const text = '<img alt="x" src="a.png" width="10">\n<img src=\'b.png\'/>'
    const r = await uploadLocalImages(text, BASE, upload, exists)
    expect(r.text).toBe('<img alt="x" src="/api/files/a.png/download" width="10">\n<img src=\'/api/files/b.png/download\'/>')
  })

  it('順番に上げる（並列にしない）', async () => {
    const order: string[] = []
    let running = 0
    let maxRunning = 0
    const upload = async (abs: string) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 5))
      order.push(abs)
      running--
      return `/api/files/${order.length}/download`
    }
    await uploadLocalImages('![a](a.png)\n![b](b.png)', BASE, upload, () => true)
    expect(maxRunning).toBe(1)
    expect(order).toEqual([resolve(BASE, 'a.png'), resolve(BASE, 'b.png')])
  })

  it('1つでも失敗したら、失敗したパスを含めて throw する', async () => {
    const { upload, exists } = setup([resolve(BASE, 'a.png')], resolve(BASE, 'a.png'))
    await expect(uploadLocalImages('![a](a.png)', BASE, upload, exists)).rejects.toThrow(resolve(BASE, 'a.png'))
  })
})
