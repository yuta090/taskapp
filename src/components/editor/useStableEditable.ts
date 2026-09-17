'use client'

import { useEffect, useRef, useState } from 'react'

/** 中身を書き換えて使うエディタ。BlockNote の本体だけを受ける */
interface EditableTarget {
  isEditable: boolean
}

/**
 * BlockNote へ渡す「書いてよいか」を、**載せたときの値で固定する**ための道具。
 *
 * BlockNote はこの値が変わると、エディタをいったん外して丸ごと作り直す
 * （`@blocknote/react` の `BlockNoteView` が、値を載せ直しの判断に使っているため）。
 * 作り直しはカーソルの位置も見ていた場所も失う無駄で、さらに**同時編集をつないでいると
 * 取り消し（Ctrl+Z / Cmd+Z）の控えを持つ係ごと片付けられ、作り直されない**。
 * そのため、議事録では同時編集を入れた組織だけ取り消しがまったく効かなくなっていた
 * （2026-09-17 のユーザー報告。`docs/spec/COEDITING_SPEC.md` の10章）。
 *
 * 「書いてよいか」は、開く途中で何度も変わる。
 * - 同時編集: 本文が器に届くまで読み取り専用 → 届いたら書ける
 * - タスク化のあいだだけ読み取り専用 → 終わると戻る
 * - 自分の役割が、本文より遅れて決まる
 *
 * そこで、渡す値は載せたときのまま動かさず、以後の変化は `editor.isEditable` で当てる。
 * BlockNote の道具立て（「/」メニュー・行の取っ手・表の取っ手・文字の飾り）はどれも
 * こちらの値を見ているので、読み取り専用の守りは弱くならない。
 *
 * **エディタを作るときは `STABLE_EDITOR_DOM_ATTRIBUTES` も一緒に渡すこと**（下を参照）。
 *
 * @returns `BlockNoteView` の `editable` に渡す値
 */
export function useStableEditable(editor: EditableTarget, editable: boolean): boolean {
  // 載せたときの値。以後どれだけ変わっても、BlockNote へはこの値を渡し続ける
  const [mountEditable] = useState(editable)
  // エディタは中身を書き換えて使う道具なので、ref 越しに触る
  const editorRef = useRef(editor)

  // 依存の配列はあえて付けない。万一 BlockNote が器ごと載せ直すと、値は上の
  // 「載せたときの値」に巻き戻る。毎回の描画で当て直せば、次の描画で必ず直る。
  // BlockNote の入り口が「同じ値なら何もしない」と守っているので、走っても実質は比較1回
  useEffect(() => {
    editorRef.current = editor
    editorRef.current.isEditable = editable
  })

  return mountEditable
}

/**
 * エディタを作るときに `domAttributes.editor` へ渡す。**本文に Tab で入るための印**を、
 * 読み取り専用にしても消えないようにする。
 *
 * BlockNote は同じ印を `tabIndex`（大文字まじり）で付けているが、ProseMirror は
 * 名前ちがいの別物として扱う。読み取り専用にすると、下ごしらえ側が付けていた
 * `tabindex`（小文字）のほうが消え、**同じ場所を指しているせいで印そのものが外れる**。
 * ここで小文字の名前で常に付けておくと、消える側が無くなっても印が残る。
 *
 * 外れたままだと、キーボードだけで操作する人が読み取り専用の本文へ入れず、
 * 矢印キーで読み進められない。BlockNote 自身はエディタを載せ直すことでこれを
 * 避けているが、載せ直すと取り消し（Ctrl+Z）の控えが消えるので使えない。
 *
 * **ほかの印も渡したくなったら、これを置き換えず広げること**:
 * `domAttributes: { editor: { ...STABLE_EDITOR_DOM_ATTRIBUTES, 'data-x': '1' } }`
 */
export const STABLE_EDITOR_DOM_ATTRIBUTES = { tabindex: '0' } as const
