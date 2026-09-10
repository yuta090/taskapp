# AgentPM CLI（agentpm）

[AgentPM](https://agentpm.app) のタスク・Wiki・ファイルを、ターミナルや AI（Claude Code など）から操作するためのコマンドです。

## インストール

```bash
npm install -g @uzukko/agentpm
```

Node.js 18 以上が必要です。同じコマンドで最新版に更新できます。

## ログイン

```bash
agentpm login
```

| 聞かれるもの | 入れるもの |
|---|---|
| API URL | 何も入れずに Enter（https://agentpm.app） |
| API Key | AgentPM の「設定 → APIキー」または「プロジェクト設定 → API設定」で発行したキー |
| Default Space ID | よく使うプロジェクトのID（省略可） |

つながったかどうかは `agentpm space list` で確かめられます。

> APIキーは合鍵です。AI のチャットに貼らず、ご自身でターミナルに入力してください。

## AI に使い方を覚えさせる

Claude Code の場合（実行後に Claude Code を開き直してください）:

```bash
mkdir -p ~/.claude/skills/agentpm && curl -fsSL https://agentpm.app/skills/agentpm/SKILL.md -o ~/.claude/skills/agentpm/SKILL.md
```

ほかの AI（Codex・Cursor など）の場合は、「https://agentpm.app/skills/agentpm/SKILL.md を読んで、AgentPM の CLI（agentpm）の使い方を覚えてください」とチャットで頼んでください。

## コマンド

```bash
agentpm --help
agentpm task --help
agentpm task create --title "見積もりを送る" --json
```

コマンドの一覧は AgentPM のサーバーから取得します。CLI を入れ直さなくても新しいコマンドが使えます（`agentpm update` で取り直し）。
