// profiles.display_name は空文字を許す既定値（NOT NULL）なので、
// 「未設定」の判定には `??` でなく `||` を使う（空文字だとメールを引いていても
// 表示が空欄になってしまうため）
export function resolveActorName(displayName: string | null | undefined, email: string | undefined): string {
  return displayName || email || 'System'
}
