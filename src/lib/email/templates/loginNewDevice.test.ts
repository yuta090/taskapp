import { describe, it, expect } from 'vitest'
import {
  LOGIN_NEW_DEVICE_TEMPLATE_DEFAULTS,
  formatBrowserLabel,
  formatJstDateTimeLabel,
  renderLoginNewDeviceEmail,
} from './loginNewDevice'

const vars = { dateTimeLabel: '2026年9月7日 10:05', browserLabel: 'Chrome (Mac)', email: 'user@example.com', appName: 'AgentPM' }

describe('login new device email', () => {
  it('件名・本文に日時・ブラウザ・メールアドレスが差し込まれる', () => {
    const out = renderLoginNewDeviceEmail({ fields: LOGIN_NEW_DEVICE_TEMPLATE_DEFAULTS, vars, ctaUrl: 'https://agentpm.app/reset' })
    expect(out.subject).toBe('【AgentPM】新しい端末からログインがありました')
    expect(out.html).toContain('新しい端末からのログイン')
    expect(out.html).toContain('2026年9月7日 10:05 に、Chrome (Mac) から user@example.com のアカウントにログインがありました。')
    expect(out.html).toContain('心当たりがない場合は、すぐにパスワードを変更してください。')
    expect(out.html).toContain('>パスワードを変更する</a>')
    expect(out.html).toContain('href="https://agentpm.app/reset"')
    expect(out.text).toContain('パスワードを変更する:\nhttps://agentpm.app/reset')
  })

  it('formatBrowserLabel: 主要ブラウザ・OSを判定する', () => {
    expect(formatBrowserLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36')).toBe('Chrome (Mac)')
    expect(formatBrowserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('Edge (Windows)')
    expect(formatBrowserLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari (iPhone)')
    expect(formatBrowserLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36')).toBe('Chrome (Android)')
    expect(formatBrowserLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/128.0')).toBe('Firefox (Linux)')
  })

  it('formatBrowserLabel: UA が無い/未知でも例外を投げず既定文言を返す', () => {
    expect(formatBrowserLabel(null)).toBe('その他のブラウザ (その他のOS)')
    expect(formatBrowserLabel(undefined)).toBe('その他のブラウザ (その他のOS)')
    expect(formatBrowserLabel('curl/8.0')).toBe('その他のブラウザ (その他のOS)')
  })

  it('formatJstDateTimeLabel: JST成分から「yyyy年m月d日 HH:mm」を組み立てる', () => {
    expect(formatJstDateTimeLabel(new Date(2026, 8, 7, 10, 5))).toBe('2026年9月7日 10:05')
    expect(formatJstDateTimeLabel(new Date(2026, 0, 1, 0, 0))).toBe('2026年1月1日 00:00')
  })
})
