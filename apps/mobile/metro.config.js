// Metro（アプリの JS をまとめる仕組み）の設定。
//
// Web（リポジトリ直下の src）の「画面に依存しない純粋なロジック」をアプリでもそのまま使う
// （マイタスクの並べ方・通知の文面など。2か所に書くと食い違うため）。そのために:
// - リポジトリ直下の src を監視対象に入れる（アプリのフォルダの外なので、既定では見えない）
// - `@/…` をリポジトリ直下の src に向ける（Web 側のファイルが互いを `@/…` で参照している）
// アプリ自身のコードは `~/…`。tsconfig.json の paths と対になっている。
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const webSrc = path.resolve(projectRoot, '../../src')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders ?? []), webSrc]

// macOS は exFAT など一部のドライブで、ファイルごとに `._名前` という付属ファイルを作る。
// Expo Router が src/app のそれを画面として読み、起動時に SyntaxError で止まる（2026-10-01）。読まないようにする。
const appleDoubleFiles = /[\\/]\._[^\\/]*$/
config.resolver.blockList = [...[config.resolver.blockList ?? []].flat(), appleDoubleFiles]

const upstreamResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = moduleName.startsWith('@/')
    ? path.join(webSrc, moduleName.slice(2))
    : moduleName.startsWith('~/')
      ? path.join(projectRoot, 'src', moduleName.slice(2))
      : moduleName
  const resolve = upstreamResolveRequest ?? context.resolveRequest
  return resolve(context, target, platform)
}

module.exports = config
