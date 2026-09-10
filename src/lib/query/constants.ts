/**
 * react-query 共通の既定値。QueryProvider の staleTime と、/my の詳細パネル
 * （MyTasksClient）が「一覧より少しくらい古いキャッシュならそのまま見せてよい」と
 * 判断する許容誤差(SHOW_TOLERANCE_MS)は、意図して同じ値を使う。
 *
 * プロジェクト画面自身がこの時間はキャッシュを信頼している（staleTime内は
 * 自動で取り直さない）のだから、詳細パネルにも同じだけの信頼を与える、という理屈。
 * 値を変える場合は両方の意味に影響することを踏まえて検討する。
 */
export const DEFAULT_STALE_TIME_MS = 2 * 60_000
