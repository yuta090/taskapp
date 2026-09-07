import { Suspense } from 'react'
import MfaChallengeClient from './MfaChallengeClient'

/** 二要素認証のコード入力（ログイン直後・認証アプリ登録済みの人だけ来る） */
export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengeClient />
    </Suspense>
  )
}
