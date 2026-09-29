/**
 * 外からアプリを開いたリンク（agentpm://…）のうち、画面遷移に使わないものを外す。
 * Google ログインの戻り（auth/callback）は、ログイン処理（~/api/googleSignIn.ts）が受け取る。
 * Android ではこのリンクでアプリ自体が開き直されるので、外さないと存在しない画面に移ってしまう。
 */
export function redirectSystemPath(path: string): string | null {
  return /(^|\/)auth\/callback(\?|#|$)/.test(path.replace(/^[a-z]+:\/\//i, '/')) ? null : path
}
