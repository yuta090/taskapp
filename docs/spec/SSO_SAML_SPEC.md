# SSO/SAML 実装仕様

## ステータス: 実装予定

## 概要

AgentPMにSSO/SAML認証を実装する。Business以上のプランで利用可能。

## 対応予定時期

| 機能 | 時期 |
|------|------|
| SSO/SAML認証 | 2026年Q3 |
| SCIM（自動プロビジョニング） | 2026年Q4 |

## 対応IdP（Identity Provider）

- Google Workspace
- Azure AD (Microsoft Entra ID)
- Okta
- OneLogin
- SAML 2.0準拠の汎用IdP

## プラン制限

| プラン | SSO/SAML |
|--------|----------|
| Free | × |
| Team | × |
| Business | ✓ |
| Agency | ✓ |

## 技術方針

### Supabase Auth SAML対応

Supabase AuthはSAML 2.0 SSOをネイティブサポートしている。

```
認証フロー:
1. ユーザーがAgentPMログイン画面にアクセス
2. メールドメインからSSO設定を自動判定
3. IdPのログイン画面にリダイレクト
4. IdPで認証完了 → SAMLアサーションをAgentPMに返却
5. Supabase Authがアサーションを検証 → セッション発行
```

### 主要実装タスク

1. **Supabase SAML設定**
   - `supabase.auth.signInWithSSO()` の実装
   - ドメインベースのIdP自動判定
   - SAML metadata URLの登録管理

2. **管理画面**
   - SSO設定画面（Business/Agency管理者のみ）
   - IdP接続テスト機能
   - ドメイン検証（DNS TXTレコード）

3. **ユーザー管理**
   - SSO経由ユーザーの自動作成（JIT Provisioning）
   - ローカルパスワード無効化（SSO強制モード）
   - SSO無効時のフォールバック

4. **SCIM（Q4）**
   - ユーザー自動作成/無効化
   - グループ→組織/ロールのマッピング
   - Okta/Azure AD SCIMコネクタ対応

## セキュリティ要件

- SAML署名検証必須
- アサーション暗号化対応
- セッションタイムアウト（IdP設定連動）
- 強制SSO設定時、パスワードログイン無効化
- 監査ログにSSO認証イベント記録

## LP原稿との関連

- `/pricing`: Business以上でSSO/SAML対応と記載
- `/compare`: 機能比較表に「SSO/SAML ○ Business以上」と記載
- FAQ: 対応IdP一覧を記載
- 稟議用セキュリティチェックシートに含める

## 参考

- Supabase SAML SSO: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- SAML 2.0仕様: http://docs.oasis-open.org/security/saml/v2.0/
