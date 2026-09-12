/**
 * /api/keys/user が 400 で返す理由(英語)を、画面に出す日本語の文言に変換する。
 * 一致しない・未知の理由は、決まった一般文言に倒す（サーバーの生の文言をそのまま出さない）。
 */
export function describeApiKeyCreateError(reason: string | undefined): string {
  switch (reason) {
    case 'Selected projects must belong to the same organization':
      return '選んだプロジェクトが複数の組織にまたがっています。1つの組織のプロジェクトだけを選んでください'
    case 'Missing required fields':
      return 'キー名と、アクセス許可するプロジェクトを入力してください'
    case 'Invalid allowedActions':
      return '許可する操作の指定が正しくありません'
    default:
      return 'APIキーの作成に失敗しました'
  }
}
