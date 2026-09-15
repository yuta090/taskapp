/**
 * 議事録の編集で出る「案内文（プレースホルダ）」の検査。
 *
 * きっかけ: `[]` と打ってチェックの行を作ると、部品（BlockNote）の既定の案内文
 * 「リストを追加」だけが出て、タスクにする行の書き方にたどり着けなかった。
 * 画面に出ている「タスクにする行」へ案内する文言に差し替える。
 */
import { describe, expect, it } from 'vitest'
import { ja as jaLocale } from '@blocknote/core/locales'
import { MINUTES_DICTIONARY } from '@/components/meeting/minutesDictionary'

describe('議事録の案内文', () => {
  it('チェックの行では、既定の「リストを追加」を出さない', () => {
    expect(jaLocale.placeholders.checkListItem).toBe('リストを追加')
    expect(MINUTES_DICTIONARY.placeholders.checkListItem).not.toBe('リストを追加')
  })

  it('チェックの行の案内文は、画面に出ているボタン名「タスクにする行」を指す', () => {
    expect(MINUTES_DICTIONARY.placeholders.checkListItem).toContain('タスクにする行')
  })

  it('文書全体が空のときの案内は出さない（外側に同じ案内があるため）', () => {
    expect(MINUTES_DICTIONARY.placeholders.emptyDocument).toBe('')
  })

  it('空行の案内は「/」でメニューが開くと伝える', () => {
    expect(MINUTES_DICTIONARY.placeholders.default).toContain('/')
  })

  it('折りたたみの説明に近道（>）を書いている', () => {
    expect(MINUTES_DICTIONARY.slash_menu.toggle_list.subtext).toContain('>')
  })
})
