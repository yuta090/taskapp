import { describe, it, expect } from 'vitest'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { docPollSpec } from '@/components/editor/docPoll/docPollBlock'

/**
 * 投票をコピーして Slack やメールに貼ったとき（外へ出す HTML）に、押した人の名前やメモが
 * 付いていかないこと。外へ出すのは「投票」の印と議題だけ（DOC_VOTE_SPEC §8）。
 */
describe('投票ブロックを外へ出すときの形', () => {
  const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, docPoll: docPollSpec } })

  it('議題だけを出し、ボタンや押した人の欄は出さない', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const html = await editor.blocksToHTMLLossy([
      {
        type: 'docPoll',
        props: { pollId: '0b6f0c1e-7a3d-4c1b-9e2a-1f2e3d4c5b6a', reasonRequired: 'ng_hold' },
        content: [{ type: 'text', text: 'デザイン案Bで進める', styles: {} }],
      } as never,
    ])
    expect(html).toContain('デザイン案Bで進める')
    expect(html).toContain('投票')
    expect(html).not.toMatch(/OK|NG|保留|読み込み中|この画面では/)
  })
})
