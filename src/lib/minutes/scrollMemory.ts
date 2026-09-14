/**
 * 議事録の「見ていた場所」を覚えて、戻ってきたときに同じところへ戻す。
 *
 * 議事録からタスクや Wiki のリンクで移ると、別の画面に切り替わる。戻ってくると議事録は
 * 一から組み立て直され、スクロールは先頭に戻る。長い議事録ほど毎回探し直しになる
 * （ユーザー報告）。
 *
 * 覚えるのはブラウザの中だけ（sessionStorage）。サーバーには送らない。
 * タブを閉じれば消える程度の一時的なもので、残し続ける価値のある情報ではない。
 *
 * **本文が大きく変わっていたら戻さない。** 誰かが前半をまるごと書き換えていた場合、
 * 同じ座標は別の場所を指す。ずれた場所に飛ぶくらいなら先頭のままのほうが混乱しない。
 */

const PREFIX = 'minutes-scroll:'

/** 本文がどれくらい変わったら「別物」とみなすか（長さの比） */
const LENGTH_TOLERANCE = 0.2

interface Saved {
  top: number
  /** 覚えたときの本文の長さ。戻すときに大きく変わっていないかを見る */
  length: number
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // プライベートウィンドウ等で触れないことがある。覚えられないだけで画面は動くべき
    return null
  }
}

export function saveMinutesScroll(meetingId: string, top: number, bodyLength: number): void {
  const s = storage()
  if (!s) return
  // 先頭は覚えない。覚えても意味が無いうえ、次に開いたとき「戻した」と誤解させる
  if (top <= 0) {
    try {
      s.removeItem(PREFIX + meetingId)
    } catch {
      /* 触れないなら何もしない */
    }
    return
  }
  try {
    s.setItem(PREFIX + meetingId, JSON.stringify({ top, length: bodyLength } satisfies Saved))
  } catch {
    /* 容量超過など。覚えられないだけ */
  }
}

/**
 * 戻す位置。覚えていない・本文が大きく変わった・読めない値なら null（＝先頭のまま）。
 */
export function readMinutesScroll(meetingId: string, bodyLength: number): number | null {
  const s = storage()
  if (!s) return null
  let raw: string | null = null
  try {
    raw = s.getItem(PREFIX + meetingId)
  } catch {
    return null
  }
  if (!raw) return null

  let saved: Saved
  try {
    saved = JSON.parse(raw) as Saved
  } catch {
    return null
  }
  if (typeof saved.top !== 'number' || !Number.isFinite(saved.top) || saved.top <= 0) return null
  if (typeof saved.length !== 'number' || !Number.isFinite(saved.length)) return null

  // 本文の長さが2割以上変わっていたら別物とみなす
  const longest = Math.max(saved.length, bodyLength)
  if (longest > 0 && Math.abs(saved.length - bodyLength) / longest > LENGTH_TOLERANCE) return null

  return saved.top
}

/**
 * 戻す位置を取り出して、覚えていたものは消す（**使い切り**）。
 *
 * 「移動して戻ってきた1回だけ戻す」が欲しい動き。覚えたままにすると、画面を組み直す
 * 別のきっかけ（タスク化・最新を読み込む）でもう一度戻され、**今読んでいた場所から
 * 勝手に飛ぶ**。戻さなかったときも消す（次に効く保証が無い古い場所を残さない）。
 */
export function takeMinutesScroll(meetingId: string, bodyLength: number): number | null {
  const top = readMinutesScroll(meetingId, bodyLength)
  clearMinutesScroll(meetingId)
  return top
}

export function clearMinutesScroll(meetingId: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(PREFIX + meetingId)
  } catch {
    /* 触れないなら何もしない */
  }
}
