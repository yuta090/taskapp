import { redirectSystemPath as decide } from '~/lib/systemPath'

// 外から開かれたリンクの行き先を決める（expo-router の特別なファイル）
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return decide(path)
  } catch {
    return path
  }
}
