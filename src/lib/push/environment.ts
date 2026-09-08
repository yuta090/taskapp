/**
 * ブラウザ通知が使える環境かの判定（純関数）。
 *
 * iPhone/iPad の Safari は、**ホーム画面に追加した状態（PWA）でしか** Web Push を扱えない。
 * ふつうのタブでは PushManager 自体が存在しないため、素朴に見ると「非対応」に見えてしまい、
 * 「このブラウザは対応していません」と案内してしまう。実際は追加すれば使えるので、
 * その場合だけ別のメッセージを出せるように環境を3つに分ける。
 */
export type PushEnvironment =
  /** そのまま許可すれば受け取れる */
  | 'supported'
  /** iPhone/iPad。ホーム画面に追加すれば受け取れる */
  | 'ios_needs_home_screen'
  /** 本当に対応していない */
  | 'unsupported'

export interface PushEnvironmentInput {
  userAgent: string
  /** window に PushManager / Notification / serviceWorker が揃っているか */
  hasPushApi: boolean
  /** ホーム画面から起動した状態か（display-mode: standalone） */
  isStandalone: boolean
}

export function isIosDevice(userAgent: string): boolean {
  // iPadOS 13以降は既定で Macintosh を名乗るため、タッチ有無では判別できない。
  // ここでは「iPhone/iPad/iPod を名乗るもの」だけを iOS とみなす（誤って
  // Mac に「ホーム画面に追加」を案内しないほうを優先する）。
  return /iPad|iPhone|iPod/.test(userAgent)
}

export function detectPushEnvironment({
  userAgent,
  hasPushApi,
  isStandalone,
}: PushEnvironmentInput): PushEnvironment {
  if (hasPushApi) return 'supported'
  if (isIosDevice(userAgent) && !isStandalone) return 'ios_needs_home_screen'
  return 'unsupported'
}

/** ブラウザから実際の環境を読む（テストしやすいよう判定本体とは分ける） */
export function readPushEnvironment(): PushEnvironment {
  if (typeof window === 'undefined') return 'unsupported'
  const hasPushApi =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return detectPushEnvironment({ userAgent: navigator.userAgent, hasPushApi, isStandalone })
}
