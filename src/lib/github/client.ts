// GitHub API Client
import { GITHUB_CONFIG } from './config'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

// Installation用のOctokitインスタンスを作成
export async function createInstallationOctokit(installationId: number): Promise<Octokit> {
  const auth = createAppAuth({
    appId: GITHUB_CONFIG.appId,
    privateKey: GITHUB_CONFIG.privateKey,
    installationId,
  })

  const { token } = await auth({ type: 'installation' })

  return new Octokit({
    auth: token,
    baseUrl: GITHUB_CONFIG.apiBaseUrl,
  })
}

// App用のOctokitインスタンスを作成（JWT認証）
export function createAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: GITHUB_CONFIG.appId,
      privateKey: GITHUB_CONFIG.privateKey,
    },
    baseUrl: GITHUB_CONFIG.apiBaseUrl,
  })
}

// Installation Access Tokenを取得
export async function getInstallationAccessToken(installationId: number): Promise<{
  token: string
  expiresAt: Date
}> {
  const auth = createAppAuth({
    appId: GITHUB_CONFIG.appId,
    privateKey: GITHUB_CONFIG.privateKey,
    installationId,
  })

  const { token, expiresAt } = await auth({ type: 'installation' })

  return {
    token,
    expiresAt: new Date(expiresAt || Date.now() + 60 * 60 * 1000), // デフォルト1時間
  }
}

// インストールされたリポジトリ一覧を取得
export async function getInstallationRepositories(installationId: number) {
  const octokit = await createInstallationOctokit(installationId)

  const { data } = await octokit.apps.listReposAccessibleToInstallation({
    per_page: 100,
  })

  return data.repositories
}

// PRの詳細を取得
export async function getPullRequest(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number
) {
  const octokit = await createInstallationOctokit(installationId)

  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  })

  return data
}

// リポジトリのPR一覧を取得（ページネーション対応）
export async function listPullRequests(
  installationId: number,
  owner: string,
  repo: string,
  options: {
    state?: 'open' | 'closed' | 'all'
    page?: number
    perPage?: number
  } = {}
) {
  const octokit = await createInstallationOctokit(installationId)

  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: options.state || 'all',
    page: options.page || 1,
    per_page: options.perPage || 30,
    sort: 'updated',
    direction: 'desc',
  })

  return data
}
