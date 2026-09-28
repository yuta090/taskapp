import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveToggleButtonForTitleClick,
  isOnColumnRightEdge,
  computeAutoFitWidth,
  withColumnWidth,
  AUTO_FIT_MIN_WIDTH,
  AUTO_FIT_MAX_WIDTH,
} from '@/components/editor/editorClickBehaviors'

// BlockNote の折りたたみの DOM と同じ形を組む。
// 折りたたみの行（.bn-toggle-wrapper）の中に三角のボタンと題名があり、
// 中身の行は行の外（.bn-block-group）に並ぶ
function buildToggle() {
  document.body.innerHTML = `
    <div class="bn-block" data-id="t1">
      <div>
        <div class="bn-toggle-wrapper" data-show-children="false">
          <button class="bn-toggle-button" type="button"><svg><path /></svg></button>
          <div class="bn-block-content" data-content-type="toggleListItem">
            <p class="bn-inline-content"><span id="title">題名の文字</span><a id="link" href="/x">リンク</a></p>
          </div>
        </div>
      </div>
      <div class="bn-block-group">
        <div class="bn-block" data-id="c1"><p id="child">中身の行</p></div>
      </div>
    </div>`
  return {
    title: document.getElementById('title')!,
    link: document.getElementById('link')!,
    child: document.getElementById('child')!,
    button: document.querySelector('.bn-toggle-button') as HTMLElement,
    svgPath: document.querySelector('.bn-toggle-button path')!,
  }
}

const click = (target: EventTarget, extra: Record<string, unknown> = {}) => ({
  target,
  button: 0,
  detail: 1,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...extra,
})

describe('resolveToggleButtonForTitleClick', () => {
  let dom: ReturnType<typeof buildToggle>
  beforeEach(() => {
    dom = buildToggle()
  })

  it('題名の文字をクリックしたら、その行の三角のボタンを返す', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.title), true)).toBe(dom.button)
  })

  it('三角のボタンそのものを押したときは返さない（二重に開閉しない）', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.button), true)).toBeNull()
    expect(resolveToggleButtonForTitleClick(click(dom.svgPath), true)).toBeNull()
  })

  it('題名の中のリンクを押したときは返さない（リンクの移動を優先する）', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.link), true)).toBeNull()
  })

  it('中身の行をクリックしても返さない', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.child), true)).toBeNull()
  })

  it('文字をなぞって選んだあとのクリックでは返さない', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.title), false)).toBeNull()
  })

  it('ダブルクリックの2回目では返さない（1回目で開閉済み。単語の選択だけにする）', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.title, { detail: 2 }), true)).toBeNull()
  })

  it('修飾キーつき・右クリック・処理済みのクリックでは返さない', () => {
    expect(resolveToggleButtonForTitleClick(click(dom.title, { shiftKey: true }), true)).toBeNull()
    expect(resolveToggleButtonForTitleClick(click(dom.title, { metaKey: true }), true)).toBeNull()
    expect(resolveToggleButtonForTitleClick(click(dom.title, { button: 2 }), true)).toBeNull()
    expect(resolveToggleButtonForTitleClick(click(dom.title, { defaultPrevented: true }), true)).toBeNull()
  })

  it('折りたたみでない行では返さない', () => {
    document.body.innerHTML = '<p id="p">ふつうの段落</p>'
    expect(resolveToggleButtonForTitleClick(click(document.getElementById('p')!), true)).toBeNull()
  })
})

describe('isOnColumnRightEdge', () => {
  it('セルの右端から数ピクセル以内なら境目とみなす', () => {
    expect(isOnColumnRightEdge(198, 200)).toBe(true)
    expect(isOnColumnRightEdge(202, 200)).toBe(true)
  })

  it('右端から離れたところ（セルの中身）は境目ではない', () => {
    expect(isOnColumnRightEdge(150, 200)).toBe(false)
    expect(isOnColumnRightEdge(190, 200)).toBe(false)
  })
})

describe('computeAutoFitWidth', () => {
  it('いちばん長い中身に、余白ぶんを足した幅にする', () => {
    expect(computeAutoFitWidth([40, 120.4, 80], 20)).toBe(141)
  })

  it('短すぎる列は下限でとめる', () => {
    expect(computeAutoFitWidth([2], 20)).toBe(AUTO_FIT_MIN_WIDTH)
    expect(computeAutoFitWidth([], 20)).toBe(AUTO_FIT_MIN_WIDTH)
  })

  it('長すぎる列は上限でとめる（そこから先は折り返す）', () => {
    expect(computeAutoFitWidth([2000], 20)).toBe(AUTO_FIT_MAX_WIDTH)
  })
})

describe('withColumnWidth', () => {
  it('指定した列だけ幅を入れ、ほかの列はそのまま残す', () => {
    expect(withColumnWidth([100, undefined, 80], 3, 1, 150)).toEqual([100, 150, 80])
  })

  it('幅がまだ1つも無い表でも、列の数だけ枠を作って入れる', () => {
    expect(withColumnWidth([], 3, 2, 90)).toEqual([undefined, undefined, 90])
  })
})
