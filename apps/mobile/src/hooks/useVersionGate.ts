/**
 * 起動時に「この版はまだ使えるか」をサーバーに確かめる（~/lib/version.ts の説明を参照）。
 */
import Constants from 'expo-constants'
import { useEffect, useState } from 'react'
import { isVersionSupported, parseMinSupportedVersion } from '~/lib/version'

const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://agentpm.app'

export function useVersionGate(): { updateRequired: boolean } {
  const [minVersion, setMinVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${WEB_BASE_URL}/api/mobile/version`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setMinVersion(parseMinSupportedVersion(json))
      })
      // 圏外・サーバー障害では止めない
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return { updateRequired: !isVersionSupported(Constants.expoConfig?.version, minVersion) }
}
