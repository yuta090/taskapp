/**
 * 最後に開いたプロジェクトを端末に覚えておく（アプリを開き直したとき、そのプロジェクトを開く）。
 * AsyncStorage（暗号化されない）なので、入れるのは id だけ。読み書きに失敗しても画面は止めない。
 * 循環 import を避けるため useSession は import しない（useSession 側から clearLastProjects を呼ぶ）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LAST_PROJECT_KEY_PREFIX, lastProjectKey } from '~/lib/lastProject'

export async function saveLastProject(userId: string, orgId: string, spaceId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(lastProjectKey(userId, orgId), spaceId)
  } catch {
    // 保存できなくても使い続けられる
  }
}

export async function loadLastProject(userId: string, orgId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastProjectKey(userId, orgId))
  } catch {
    return null
  }
}

/** ログアウト時に、端末に残った「最後に開いたプロジェクト」をすべて消す */
export async function clearLastProjects(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const targets = keys.filter((k) => k.startsWith(LAST_PROJECT_KEY_PREFIX))
    if (targets.length > 0) await AsyncStorage.multiRemove(targets)
  } catch {
    // 消せなくても、キーに userId が入っているので別の人には使われない
  }
}

// 起動後に開き直すのは1回だけ。タブを行き来したり、組織を手で切り替えたあとに勝手に開かないための印
let restoreDone = false

export function isProjectRestoreDone(): boolean {
  return restoreDone
}

export function markProjectRestoreDone(): void {
  restoreDone = true
}

/** ログアウトしたとき、次にログインした人でもう一度開き直せるように印を戻す */
export function resetProjectRestore(): void {
  restoreDone = false
}
