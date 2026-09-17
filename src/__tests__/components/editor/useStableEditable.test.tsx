// @vitest-environment jsdom
/**
 * 「書いてよいか」をエディタへ当てる道具の確かめ。
 *
 * 守りたいのは2つ。
 *  - BlockNote へ渡す値は動かさない（動かすとエディタが丸ごと作り直され、
 *    同時編集をつないでいると取り消しの控えごと消える）
 *  - それでも読み取り専用は、その場で本当に効く
 *
 * 「読み取り専用でも本文に Tab で入れる」ことは、実際の画面で確かめている
 * （`WikiEditor.undo.test.tsx` と `MinutesEditor.undo.test.tsx`）。
 */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { STABLE_EDITOR_DOM_ATTRIBUTES, useStableEditable } from '@/components/editor/useStableEditable'

function fakeEditor() {
  return { isEditable: true }
}

describe('useStableEditable', () => {
  it('BlockNote へ渡す値は、あとで変わっても載せたときのまま', () => {
    const editor = fakeEditor()
    const { result, rerender } = renderHook(({ editable }) => useStableEditable(editor, editable), {
      initialProps: { editable: false },
    })
    expect(result.current).toBe(false)

    rerender({ editable: true })
    expect(result.current).toBe(false)

    rerender({ editable: false })
    expect(result.current).toBe(false)
  })

  it('「書いてよいか」の変化は、エディタ本体にその場で当たる', () => {
    const editor = fakeEditor()
    const { rerender } = renderHook(({ editable }) => useStableEditable(editor, editable), {
      initialProps: { editable: false },
    })
    expect(editor.isEditable).toBe(false)

    rerender({ editable: true })
    expect(editor.isEditable).toBe(true)

    rerender({ editable: false })
    expect(editor.isEditable).toBe(false)
  })

  it('渡す印は、消えないほうの名前で持つ（本文に Tab で入れるように）', () => {
    // 読み取り専用にすると、下ごしらえ側が付けた同じ名前の印だけが消える。
    // こちらは小文字の名前で常に持たせるので、印そのものは残る
    expect(STABLE_EDITOR_DOM_ATTRIBUTES).toEqual({ tabindex: '0' })
  })
})
