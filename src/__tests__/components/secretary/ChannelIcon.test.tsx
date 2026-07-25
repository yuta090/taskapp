import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ChannelIcon, hasChannelIcon } from '@/components/secretary/ChannelIcon'

/**
 * ChannelIcon — チャネルのブランドロゴ（色付きインラインSVG）。
 * 正確なロゴを用意したチャネルのみ描画し、それ以外は何も出さない（誤ロゴを出さない）。
 */
describe('ChannelIcon', () => {
  it('ロゴを持つチャネル(line/discord)は svg を描画する', () => {
    const { container: line } = render(<ChannelIcon channel="line" />)
    expect(line.querySelector('svg')).not.toBeNull()
    const { container: discord } = render(<ChannelIcon channel="discord" />)
    expect(discord.querySelector('svg')).not.toBeNull()
  })

  it('google_chat / messenger もロゴを描画する（追加分）', () => {
    const { container: gc } = render(<ChannelIcon channel="google_chat" />)
    expect(gc.querySelector('svg')).not.toBeNull()
    const { container: msg } = render(<ChannelIcon channel="messenger" />)
    expect(msg.querySelector('svg')).not.toBeNull()
  })

  it('ブランド色を color スタイルに載せる（currentColor 経由でロゴが色付く）', () => {
    const { container } = render(<ChannelIcon channel="discord" />)
    const root = container.firstElementChild as HTMLElement | null
    // Discord ブランド色 #5865F2（Reactは rgb に正規化する: rgb(88,101,242)）
    expect(root?.style.color).toBe('rgb(88, 101, 242)')
  })

  it('ロゴ未整備チャネルは何も描画しない（誤ロゴを出さない）', () => {
    const { container } = render(<ChannelIcon channel="chatwork" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('未知/空チャネルも何も描画しない', () => {
    const { container: unk } = render(<ChannelIcon channel="mystery" />)
    expect(unk.firstChild).toBeNull()
    const { container: empty } = render(<ChannelIcon channel="" />)
    expect(empty.firstChild).toBeNull()
  })

  it('hasChannelIcon はロゴ有無を返す', () => {
    expect(hasChannelIcon('line')).toBe(true)
    expect(hasChannelIcon('discord')).toBe(true)
    expect(hasChannelIcon('google_chat')).toBe(true)
    expect(hasChannelIcon('messenger')).toBe(true)
    // simple-icons に無い（商標配慮で削除）ため文字のみ据え置き
    expect(hasChannelIcon('chatwork')).toBe(false)
    expect(hasChannelIcon('teams')).toBe(false)
    expect(hasChannelIcon('mystery')).toBe(false)
    expect(hasChannelIcon('')).toBe(false)
  })
})
