import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { useEditorClickBehaviors, type ClickBehaviorEditor } from '@/components/editor/editorClickBehaviors'

// 文書エディタの外枠に付けて、実際のクリックで動くかを見る

function Harness({ editor, measure, html }: { editor: ClickBehaviorEditor; measure?: (cell: HTMLElement) => number; html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEditorClickBehaviors(ref, editor, measure)
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}

const TOGGLE_HTML = `
  <div class="bn-toggle-wrapper">
    <button class="bn-toggle-button" type="button">▶</button>
    <div class="bn-block-content" data-content-type="toggleListItem"><p><span id="title">題名</span></p></div>
  </div>`

// 2列×2行の表。1行目は見出し
const TABLE_HTML = `
  <div class="bn-block" data-id="tbl">
    <div class="bn-block-content" data-content-type="table">
      <table><tbody>
        <tr><th id="h0">ID</th><th id="h1">機能</th></tr>
        <tr><td id="c0">F01</td><td id="c1">とても長い説明の文字</td></tr>
      </tbody></table>
    </div>
  </div>`

function tableBlock() {
  return {
    id: 'tbl',
    type: 'table',
    content: { type: 'tableContent', columnWidths: [undefined, undefined], rows: [{ cells: [[], []] }, { cells: [[], []] }] },
  }
}

function fakeEditor(overrides: Partial<ClickBehaviorEditor> = {}): ClickBehaviorEditor {
  return {
    isEditable: true,
    getBlock: vi.fn(() => tableBlock()),
    updateBlock: vi.fn(),
    ...overrides,
  } as ClickBehaviorEditor
}

// jsdom はレイアウトを持たないので、セルの右端の位置をこちらで決める
function placeRightEdge(el: Element, right: number) {
  el.getBoundingClientRect = () => ({ right, left: right - 100, top: 0, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON() {} }) as DOMRect
}

afterEach(() => cleanup())

describe('useEditorClickBehaviors', () => {
  it('折りたたみの題名をクリックすると、三角のボタンが押される', () => {
    const { container } = render(<Harness editor={fakeEditor()} html={TOGGLE_HTML} />)
    const button = container.querySelector('.bn-toggle-button') as HTMLButtonElement
    const onToggle = vi.fn()
    button.addEventListener('click', onToggle)

    container.querySelector('#title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('読み取り専用でも、題名のクリックで開閉できる', () => {
    const { container } = render(<Harness editor={fakeEditor({ isEditable: false })} html={TOGGLE_HTML} />)
    const onToggle = vi.fn()
    container.querySelector('.bn-toggle-button')!.addEventListener('click', onToggle)

    container.querySelector('#title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('列の右の境目をダブルクリックすると、その列を中身に合わせた幅にして保存する', () => {
    const editor = fakeEditor()
    const measure = vi.fn((cell: HTMLElement) => (cell.id === 'c1' ? 180 : 30))
    const { container } = render(<Harness editor={editor} measure={measure} html={TABLE_HTML} />)
    const cell = container.querySelector('#c1')!
    placeRightEdge(cell, 300)

    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 299 }))

    expect(measure).toHaveBeenCalledTimes(2) // 見出しと中身の2行ぶん
    expect(editor.updateBlock).toHaveBeenCalledTimes(1)
    const [, update] = (editor.updateBlock as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(update.content.columnWidths[0]).toBeUndefined()
    expect(update.content.columnWidths[1]).toBeGreaterThanOrEqual(180)
  })

  it('セルの中身をダブルクリックしても幅は変えない（単語を選ぶ動きのまま）', () => {
    const editor = fakeEditor()
    const { container } = render(<Harness editor={editor} measure={() => 50} html={TABLE_HTML} />)
    const cell = container.querySelector('#c1')!
    placeRightEdge(cell, 300)

    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 240 }))

    expect(editor.updateBlock).not.toHaveBeenCalled()
  })

  it('編集できない人のときは、境目をダブルクリックしても幅を変えない', () => {
    const editor = fakeEditor({ isEditable: false })
    const { container } = render(<Harness editor={editor} measure={() => 50} html={TABLE_HTML} />)
    const cell = container.querySelector('#c1')!
    placeRightEdge(cell, 300)

    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 299 }))

    expect(editor.updateBlock).not.toHaveBeenCalled()
  })
})
