/**
 * サーバーのコマンド一覧(manifest)に添えられた「お知らせ」を、まだ見ていない分だけ 1 回表示する。
 * 見た分の id は ~/.agentpm/notices.seen.json に残す。表示は stderr に出し、--json の stdout を汚さない。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import type { ManifestNotice } from './manifest-validator.js'

const SEEN_PATH = join(homedir(), '.agentpm', 'notices.seen.json')
/** 覚えておく id の上限(古いものから捨てる) */
const MAX_SEEN = 200

export interface NoticeStore {
  readSeen(): string[]
  writeSeen(ids: string[]): void
}

export const fileNoticeStore: NoticeStore = {
  readSeen() {
    if (!existsSync(SEEN_PATH)) return []
    const parsed = JSON.parse(readFileSync(SEEN_PATH, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  },
  writeSeen(ids) {
    mkdirSync(join(homedir(), '.agentpm'), { recursive: true, mode: 0o700 })
    const tmp = `${SEEN_PATH}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(ids), { mode: 0o600 })
    renameSync(tmp, SEEN_PATH)
  },
}

/** まだ見ていないお知らせを、日付順(古い→新しい)で返す */
export function pickUnseen(notices: ManifestNotice[] | undefined, seen: string[]): ManifestNotice[] {
  if (!notices?.length) return []
  const seenSet = new Set(seen)
  return notices
    .filter((n) => !seenSet.has(n.id))
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.date ?? '').localeCompare(b.n.date ?? '') || a.i - b.i)
    .map(({ n }) => n)
}

export function formatNotices(notices: ManifestNotice[]): string {
  const lines = notices.map((n) => `  - ${n.date ? `[${n.date}] ` : ''}${n.message}`)
  return [chalk.cyan('📣 AgentPM からのお知らせ'), ...lines, ''].join('\n')
}

export interface ShowDeps {
  store: NoticeStore
  print: (text: string) => void
}

/** 未読のお知らせを表示して既読にする。表示した件数を返す。記録の失敗では落ちない */
export function showNewNotices(
  manifest: { notices?: ManifestNotice[] },
  deps: ShowDeps = { store: fileNoticeStore, print: (t) => console.error(t) },
): number {
  let seen: string[] = []
  try {
    seen = deps.store.readSeen()
  } catch {
    /* 読めなければ全部未読として扱う */
  }
  const unseen = pickUnseen(manifest.notices, seen)
  if (unseen.length === 0) return 0

  deps.print(formatNotices(unseen))

  try {
    const next = [...seen, ...unseen.map((n) => n.id)]
    deps.store.writeSeen(next.slice(-MAX_SEEN))
  } catch {
    /* 記録できなくても次回また出るだけ */
  }
  return unseen.length
}
