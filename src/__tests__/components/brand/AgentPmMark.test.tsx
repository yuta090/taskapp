import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AgentPmMark } from '@/components/brand/AgentPmMark'

/**
 * AgentPmMark — ブランドマーク（ベタ塗り2本＋ボール）。
 *
 * 「社内と相手先がボールを受け渡す」を、塗りつぶした棒2本と円1個の
 * 3要素だけで表す。線（stroke）ではなく面（fill）で構成するのは、
 * 16px（faviconやLINEのアイコン）まで縮めても輪郭が消えないため。
 * この「3要素・文字なし・面で構成」が小サイズ判読性の条件そのものなので、
 * スタイルの好みではなく仕様としてテストで固定する。
 */
describe('AgentPmMark', () => {
  it('24グリッドの svg を描画する', () => {
    const { container } = render(<AgentPmMark />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('size を width / height に反映する', () => {
    const { container } = render(<AgentPmMark size={16} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('height')).toBe('16')
  })

  it('要素は3つ（棒2本＋ボール1個）だけで、文字を含まない', () => {
    const { container } = render(<AgentPmMark />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.children.length).toBe(3)
    expect(svg.querySelectorAll('rect')).toHaveLength(2)
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
    // 文字は小サイズで最初に潰れる。マークに文字要素を持たせない。
    expect(svg.querySelector('text')).toBeNull()
  })

  it('線ではなく面で構成する（stroke を使わない）', () => {
    const { container } = render(<AgentPmMark />)
    const svg = container.querySelector('svg') as SVGSVGElement
    for (const child of Array.from(svg.children)) {
      expect(child.getAttribute('fill')).toBe('currentColor')
      expect(child.getAttribute('stroke')).toBeNull()
    }
  })

  it('装飾なのでスクリーンリーダーから隠す', () => {
    const { container } = render(<AgentPmMark />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('色は className 経由で差し替えられる（hex を埋め込まない）', () => {
    const { container } = render(<AgentPmMark className="text-white" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('class')).toContain('text-white')
    expect(container.innerHTML).not.toMatch(/#[0-9A-Fa-f]{6}/)
  })
})

/**
 * 旧ロゴ（amber の四角に白い「A」）の残骸がないことを保証する。
 * 差し替え漏れがあると、画面によって別のロゴが出る事故になるため
 * ソースを走査して回帰を止める。
 */
describe('旧ロゴ「A」の残骸', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (name === 'node_modules' || name.startsWith('.')) return []
      if (statSync(path).isDirectory()) return tsxFiles(path)
      return path.endsWith('.tsx') ? [path] : []
    })
  }

  it('src 配下に amber バッジ内の文字「A」が残っていない', () => {
    const offenders = tsxFiles(join(process.cwd(), 'src'))
      .filter((path) => !path.includes('__tests__'))
      .filter((path) => /font-(?:bold|semibold)[^"]*">A<\/span>/.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})
