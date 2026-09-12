// GitHub App インストール完了時に、GitHub 側で利用者本人であることを確認するための
// user-to-server トークン操作。
//
// トークンは呼び出し元に戻り値として渡すだけで、DB には保存しない・ログにも出さない。
import { GITHUB_CONFIG } from './config'

const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API_BASE_URL = GITHUB_CONFIG.apiBaseUrl
// 通常は数ページで尽きるが、無限ループにはしない程度の余裕を持たせる
const MAX_INSTALLATION_PAGES = 100

export interface GitHubInstallationAccount {
  id: number
  login: string
  type: string
}

export interface GitHubUserInstallation {
  id: number
  account: GitHubInstallationAccount
}

/**
 * インストール完了後に受け取った code を、利用者本人の user-to-server トークンに交換する。
 * 交換に失敗した場合（HTTP エラー・GitHub からのエラー応答）は null を返す。
 */
export async function exchangeCodeForUserToken(code: string): Promise<string | null> {
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CONFIG.clientId,
        client_secret: GITHUB_CONFIG.clientSecret,
        code,
      }),
    })

    if (!response.ok) return null

    const data = await response.json()
    if (data.error || !data.access_token) return null

    return data.access_token as string
  } catch (e) {
    console.error('Failed to exchange GitHub OAuth code:', e)
    return null
  }
}

/**
 * 利用者本人がアクセスできるインストール一覧（GET /user/installations）から、
 * installationId と一致する項目を返す。ページングに対応し、
 * 上限（MAX_INSTALLATION_PAGES）までで確認を打ち切る。見つからなければ null。
 */
export async function findUserInstallation(
  token: string,
  installationId: number,
): Promise<GitHubUserInstallation | null> {
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page++) {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}/user/installations?per_page=100&page=${page}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      })
    } catch (e) {
      console.error('Failed to fetch GitHub user installations:', e)
      return null
    }

    if (!response.ok) return null

    const data = await response.json()
    const installations: GitHubUserInstallation[] = data.installations ?? []

    const match = installations.find((installation) => installation.id === installationId)
    if (match) return match

    // ページを尽きた（次ページが無い）
    if (installations.length < 100) return null
  }

  return null
}

/**
 * user-to-server トークンでログイン中の GitHub アカウント（GET /user）を取得する。
 * 個人アカウントのインストールで「本人か」を確認するために使う。失敗したら null。
 */
export async function getAuthenticatedGitHubUser(
  token: string,
): Promise<{ id: number; login: string } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!response.ok) {
      // トークンはログに出さない。手がかりとして HTTP ステータスだけ残す
      console.error('Failed to fetch authenticated GitHub user, status:', response.status)
      return null
    }

    const data = await response.json()
    if (typeof data.id !== 'number' || typeof data.login !== 'string') return null

    return { id: data.id, login: data.login }
  } catch (e) {
    console.error('Failed to fetch authenticated GitHub user:', e)
    return null
  }
}

/**
 * 組織アカウントのインストールで「利用者がその組織の管理者か」を確認する
 * （GET /user/memberships/orgs/{org}）。承認待ち（pending）・admin 以外の役割・
 * 404（非所属）・403・通信失敗はすべて false として扱う。
 */
export async function isOrgAdmin(token: string, orgLogin: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/user/memberships/orgs/${encodeURIComponent(orgLogin)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!response.ok) {
      // トークンはログに出さない。手がかりとして HTTP ステータスだけ残す
      console.error('Failed to fetch GitHub org membership, status:', response.status)
      return false
    }

    const data = await response.json()
    return data.state === 'active' && data.role === 'admin'
  } catch (e) {
    console.error('Failed to fetch GitHub org membership:', e)
    return false
  }
}

/**
 * user-to-server トークンを破棄する。確認が済んだトークンは残さない方針だが、
 * 破棄に失敗しても呼び出し元の処理は止めない（ログのみ）。
 */
export async function revokeUserToken(token: string): Promise<void> {
  try {
    const basicAuth = Buffer.from(`${GITHUB_CONFIG.clientId}:${GITHUB_CONFIG.clientSecret}`).toString('base64')
    const response = await fetch(`${API_BASE_URL}/applications/${GITHUB_CONFIG.clientId}/token`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: token }),
    })

    if (!response.ok) {
      // トークンはログに出さない。手がかりとして HTTP ステータスだけ残す
      console.error('Failed to revoke GitHub user token, status:', response.status)
    }
  } catch (e) {
    console.error('Failed to revoke GitHub user token:', e)
  }
}
