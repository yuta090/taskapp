import { describe, it, expect } from 'vitest'
import { collectCheckedTaskIds as appCollect } from '@/lib/minutes/checkboxCompletion'
import { collectCheckedTaskIds as cliCollect } from '../../../packages/mcp-server/src/lib/checkboxCompletion'

/**
 * 「チェックが付いている行のタスク」を拾う規則は、画面（議事録エディタ）と
 * CLI（`minutes complete-checked`）の**2か所にある**。片方だけ直すと、同じ本文なのに
 * 画面と CLI で拾う行が変わる。パッケージをまたぐので実装は共有できない。
 * ここで振る舞いを突き合わせる（specLinkParity.test.ts と同じ考え方）。
 */

const T1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const T2 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

const CASES: Array<{ name: string; md: string }> = [
  { name: 'チェック済み＋印', md: `- [x] A <!--task:${T1}-->` },
  { name: 'チェック無し＋印', md: `- [ ] A <!--task:${T1}-->` },
  { name: '大文字のチェック', md: `- [X] A <!--task:${T1}-->` },
  { name: '印なし', md: '- [x] A' },
  { name: '字下げした行', md: `  - [x] A <!--task:${T1}-->` },
  { name: '同じ印が2回', md: `- [x] A <!--task:${T1}-->\n- [x] Aの写し <!--task:${T1}-->` },
  { name: '複数の印', md: `- [x] A <!--task:${T1}-->\n- [x] B <!--task:${T2}-->` },
  { name: '段落に印', md: `ふつうの段落 <!--task:${T1}-->` },
  { name: '空', md: '' },
  { name: '壊れた目印（UUID の形でない）', md: '- [x] A <!--task:abc-->' },
  { name: '空の目印', md: '- [x] A <!--task:-->' },
  { name: '壊れた目印と正しい目印が混在', md: `- [x] A <!--task:abc-->\n- [x] B <!--task:${T1}-->` },
  { name: '記号入りの目印', md: "- [x] A <!--task:'; drop table tasks; --\u002D>" },
  { name: '混在', md: `# 会議\n\n- [x] A <!--task:${T1}-->\n- [ ] B <!--task:${T2}-->\n- [x] 印なし` },
]

describe('collectCheckedTaskIds: 画面と CLI で同じ行を拾う', () => {
  for (const { name, md } of CASES) {
    it(name, () => {
      expect(cliCollect(md)).toEqual(appCollect(md))
    })
  }
})
