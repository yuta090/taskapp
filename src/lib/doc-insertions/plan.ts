import { DOC_INSERTION_TYPE, type DocInsertion } from './logic'

type BlockLike = { id: string; type: string; props?: Record<string, unknown>; children?: BlockLike[] }

export interface InsertionSyncPlan {
  /** 本文に入れる（afterBlockId の後ろに。afterBlockId は既存のブロックか、同じ回に先に入れる差し込みの番号） */
  insert: Array<{ row: DocInsertion; afterBlockId: string; missed: boolean }>
  /** 本文にもう入っているので反映済みにする（保存されたかは DB が確かめる） */
  markApplied: string[]
  /** 本文から消すブロックの id（削除依頼） */
  remove: string[]
  /** 本文にもう無いので削除済みにする */
  markRemoved: string[]
}

function collectInsertionBlocks(doc: BlockLike[]): Map<string, BlockLike> {
  const out = new Map<string, BlockLike>()
  const walk = (blocks: BlockLike[]) => {
    for (const b of blocks) {
      if (b.type === DOC_INSERTION_TYPE && typeof b.props?.insertionId === 'string') out.set(b.props.insertionId, b)
      if (b.children?.length) walk(b.children)
    }
  }
  walk(doc)
  return out
}

/**
 * 社内の編集画面が、台帳（反映待ち・削除依頼）と今の本文を見比べて、することを決める（DOC_VOTE_SPEC §5）。
 * 足す場所は最上位の行から探す（matches: 議事録はその行の Markdown、Wiki はブロックの id で比べる）。
 * 見つからなければ末尾に付けて missed を立てる。同じ場所に続けて足すときは、先に出した方が上に来るよう、
 * 後の方を先の方の後ろに入れる（台帳は古い順に渡すこと）。
 */
export function planInsertionSync<B extends BlockLike>(
  doc: B[],
  rows: DocInsertion[],
  matches: (block: B, anchor: string) => boolean
): InsertionSyncPlan {
  const present = collectInsertionBlocks(doc)
  const plan: InsertionSyncPlan = { insert: [], markApplied: [], remove: [], markRemoved: [] }
  const last = doc[doc.length - 1]
  // 同じ場所に続けて足すとき、次はこの後ろに入れる
  const tailOf = new Map<string, string>()

  for (const row of rows) {
    const block = present.get(row.id)
    if (row.status === 'remove_requested') {
      if (block) plan.remove.push(block.id)
      else plan.markRemoved.push(row.id)
      continue
    }
    if (row.status !== 'pending') continue
    if (block) {
      plan.markApplied.push(row.id)
      continue
    }
    if (!last) continue
    let anchorId = last.id
    let missed = false
    if (row.anchor !== null) {
      const found = doc.find((b) => matches(b, row.anchor as string))
      if (found) anchorId = found.id
      else missed = true
    }
    const afterBlockId = tailOf.get(anchorId) ?? anchorId
    plan.insert.push({ row, afterBlockId, missed })
    tailOf.set(anchorId, row.id)
  }
  return plan
}
