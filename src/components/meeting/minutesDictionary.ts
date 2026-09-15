import { ja as jaLocale } from '@blocknote/core/locales'

/**
 * BlockNote の日本語辞書（`@blocknote/core/locales` の `ja`）をもとにした議事録用の辞書。
 * 画面の言葉と合わせるのが目的なので、MinutesEditor から切り出してテストできるようにしている。
 *
 * - `emptyDocument`（文書全体が空の唯一のブロックのときだけ出る案内）: 空にする。
 *   呼び出し側(MinutesDocumentView)が本文の外側に同じ趣旨の案内文を1つだけ出すため、
 *   ここで出すと「ここに議事録を書きます」が2回表示されてしまう。
 * - `default`（フォーカスした空行に出る案内）: Wiki と同じ文言。「/」でメニューが開くと伝える
 * - `checkListItem`（`[]` と打って作ったチェックの行に出る案内）: 既定は「リストを追加」で、
 *   タスクにする行の書き方にたどり着けない。本文の下に出ている「タスクにする行」を指す。
 */
export const MINUTES_DICTIONARY = {
  ...jaLocale,
  placeholders: {
    ...jaLocale.placeholders,
    default: '文字を入力、または「/」でメニューを開く',
    emptyDocument: '',
    checkListItem: 'やること。期限や資料も付けるなら「タスクにする行」から',
  },
  slash_menu: {
    ...jaLocale.slash_menu,
    toggle_list: {
      ...jaLocale.slash_menu.toggle_list,
      // 近道（`>` ＋スペース）をメニューの説明にも書く。知らないと使われない
      subtext: '中身を隠しておける。「>」とスペースでも作れる',
    },
  },
}
