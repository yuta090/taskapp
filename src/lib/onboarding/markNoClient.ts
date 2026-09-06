'use client'

import { setOnboardingFlag } from './setOnboardingFlag'

/**
 * 「クライアントなしで進める」を選んだことを記録する。
 * 実体は setOnboardingFlag('no_client')（profiles.onboarding_flags にマージ保存・他のフラグは消さない）。
 * 実際にクライアントを招待すれば done が優先されるので、取り消し操作は不要。
 */
export async function markNoClient(): Promise<void> {
  await setOnboardingFlag('no_client')
}
