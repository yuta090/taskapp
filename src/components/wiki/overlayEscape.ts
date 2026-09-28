/**
 * 重ねた Wiki（WikiPageOverlay）を Esc で閉じてよいか。
 *
 * エディタのメニューを閉じる Esc は奪わない。BlockNote の「/」メニュー・絵文字・ブロックの
 * メニュー・書式のツールバーは floating-ui が document で Esc を聞くが、preventDefault しない
 * （stopPropagation だけ）。オーバーレイの方が先に登録されるので、「止められていたら閉じない」
 * だけでは見分けられない。出ているかを DOM で確かめる。
 *
 * 逆に、メニューが出ていないときのエディタの Esc は、BlockNote（OverrideEscape）が「編集欄から
 * 外れる」ために preventDefault する。これを理由に閉じないと2回押さないと閉じないので、
 * エディタの中からの Esc は止められていても閉じる。
 */
const EDITOR_MENU_SELECTOR = '.bn-suggestion-menu, .bn-grid-suggestion-menu, .bn-menu-dropdown, .bn-toolbar'

export function shouldCloseOverlayOnEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.isComposing) return false
  if (document.querySelector(EDITOR_MENU_SELECTOR)) return false
  if (!e.defaultPrevented) return true
  const target = e.target
  return target instanceof Element && !!target.closest('.bn-editor')
}
