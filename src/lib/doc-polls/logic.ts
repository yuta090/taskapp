/**
 * 投票ブロックの計算（画面にも通信にも依らない部分）。
 * 仕様: docs/spec/DOC_VOTE_SPEC.md
 */
import type { DocPollReasonRequired, DocPollState, DocVote, DocVoteChoice, DocVoteEvent } from './types'

/** 本文（BlockNote）での投票ブロックの型名。Wiki の JSON に残るので変えない */
export const DOC_POLL_TYPE = 'docPoll'

export const DOC_VOTE_CHOICES: readonly DocVoteChoice[] = ['ok', 'ng', 'hold']

export const DOC_VOTE_LABELS: Record<DocVoteChoice, string> = {
  ok: 'OK',
  ng: 'NG',
  hold: '保留',
}

/** メモの上限（DB の check と同じ） */
export const DOC_VOTE_MEMO_MAX = 2000

/** 空白・改行・全角空白だけは「書いていない」（DB の `^[[:space:]　]*$` と同じ） */
function isBlank(memo: string): boolean {
  return /^[\s　]*$/.test(memo)
}

/** 理由を書かないと押せないか */
export function needsReason(reasonRequired: DocPollReasonRequired, choice: DocVoteChoice, memo: string): boolean {
  return reasonRequired === 'ng_hold' && choice !== 'ok' && isBlank(memo)
}

/** 選んだボタンごとに分け、押した順（最後に押し直した時刻の古い順）に並べる */
export function groupVotesByChoice(votes: DocVote[]): Record<DocVoteChoice, DocVote[]> {
  const out: Record<DocVoteChoice, DocVote[]> = { ok: [], ng: [], hold: [] }
  for (const v of [...votes].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
    out[v.choice].push(v)
  }
  return out
}

/** その人の履歴を古い順に。2件以上なら「変更あり」 */
export function historyOf(events: DocVoteEvent[], userId: string): DocVoteEvent[] {
  return events.filter((e) => e.user_id === userId).sort((a, b) => a.id - b.id)
}

/** 押せなかった理由を画面の言葉にする（DB の関数が返す印と対） */
export function voteErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.message === 'reason_required') return 'NG と保留は理由を書いてください'
  if (e.message === 'memo_too_long') return `メモは${DOC_VOTE_MEMO_MAX}字までです`
  if (e.code === '42501') return 'この投票には押せません'
  return '送れませんでした。もう一度押してください'
}

type BlockLike = { id: string; type: string; props?: Record<string, unknown>; children?: BlockLike[] }

/** 本文の投票ブロックを、上から順に拾う（字下げした子の中も） */
export function collectPollBlocks<B extends BlockLike>(doc: B[]): B[] {
  const out: B[] = []
  const walk = (blocks: B[]) => {
    for (const b of blocks) {
      if (b.type === DOC_POLL_TYPE) out.push(b)
      if (b.children?.length) walk(b.children as B[])
    }
  }
  walk(doc)
  return out
}

export function pollIdOf(block: BlockLike): string {
  const v = block.props?.pollId
  return typeof v === 'string' ? v : ''
}

/** 番号ごとの持ち主（その番号を持つ最初のブロックの id）。次に見直すときの「前の持ち主」になる */
export function pollOwnersOf(doc: BlockLike[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of collectPollBlocks(doc)) {
    const id = pollIdOf(b)
    if (id && !(id in out)) out[id] = b.id
  }
  return out
}

/**
 * 番号を振り直すブロック。番号が空のものと、同じ番号が重なったときの持ち主でない側（コピーして貼ったもの）。
 * 振り直さないと、2つのブロックが同じ票を共有してしまう。
 *
 * 持ち主は、前に見たときその番号を持っていたブロック（`owners`）。元の投票の上に貼っても、
 * 前からあった側が番号（＝集まった票）を持ち続ける。前の持ち主が分からなければ上のブロックが持つ。
 */
export function findPollBlocksToRenumber<B extends BlockLike>(doc: B[], owners: Record<string, string> = {}): B[] {
  const blocks = collectPollBlocks(doc)
  const keeper = new Map<string, B>()
  for (const b of blocks) {
    const id = pollIdOf(b)
    if (!id) continue
    const current = keeper.get(id)
    if (!current || (owners[id] === b.id && owners[id] !== current.id)) keeper.set(id, b)
  }
  return blocks.filter((b) => {
    const id = pollIdOf(b)
    return !id || keeper.get(id) !== b
  })
}

/**
 * 押した直後に、画面の票だけ先に変える（返事を待たずに見た目を変える）。履歴は触らない
 * （返事のあとに読み直すと DB の履歴が入る）。元のデータは書き換えない。
 */
export function applyOptimisticVote(
  polls: Record<string, DocPollState>,
  args: { pollId: string; userId: string; choice: DocVoteChoice | null; memo: string },
  now: string
): Record<string, DocPollState> {
  const state = polls[args.pollId]
  if (!state) return polls
  const others = state.votes.filter((v) => v.user_id !== args.userId)
  const mine = state.votes.find((v) => v.user_id === args.userId)
  const votes =
    args.choice === null
      ? others
      : [
          ...others,
          {
            poll_id: args.pollId,
            user_id: args.userId,
            choice: args.choice,
            memo: args.memo,
            created_at: mine?.created_at ?? now,
            updated_at: now,
          },
        ]
  return { ...polls, [args.pollId]: { ...state, votes } }
}

export function reasonRequiredOf(block: BlockLike): DocPollReasonRequired {
  return block.props?.reasonRequired === 'ng_hold' ? 'ng_hold' : 'none'
}

/**
 * 本文を開いている（編集できる）人の画面が、投票ブロックについて何をするか。
 * - renumber: 番号を振り直すブロック（空・重なり）
 * - create:   DB にまだ無い番号（置いた直後・作り損ねた・別の文書から貼った）
 * `known` は DB にある番号、`skip` は作っている最中か作れなかった番号、`owners` は前の持ち主。
 */
export function planPollSync<B extends BlockLike>(
  doc: B[],
  known: Record<string, unknown>,
  skip: ReadonlySet<string>,
  owners: Record<string, string> = {}
): { renumber: B[]; create: Array<{ pollId: string; reasonRequired: DocPollReasonRequired }> } {
  const renumber = findPollBlocksToRenumber(doc, owners)
  const renumberSet = new Set(renumber)
  const create: Array<{ pollId: string; reasonRequired: DocPollReasonRequired }> = []
  for (const b of collectPollBlocks(doc)) {
    if (renumberSet.has(b)) continue
    const id = pollIdOf(b)
    if (id in known || skip.has(id)) continue
    create.push({ pollId: id, reasonRequired: reasonRequiredOf(b) })
  }
  return { renumber, create }
}

/**
 * 本文に投票がありそうか（軽い目安）。無い文書では、投票の読み込み・合図のチャネル・定期の読み直しを
 * 張らない（ポータルの議事録・Wiki はほとんど投票が無く、開くたびに空振りの通信が走るため）。
 */
export function hasDocPollInMinutes(md: string | null | undefined): boolean {
  return typeof md === 'string' && md.includes('<!--vote:')
}

export function hasDocPollInWikiBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.includes(`"${DOC_POLL_TYPE}"`)
}
