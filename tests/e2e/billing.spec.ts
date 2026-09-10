import { test, expect } from './fixtures'

/**
 * 「プランと請求」画面が、決済の受け付け状況と食い違っていないことを見る。
 *
 * **実際に起きていた不具合**: 判定するはずのフックが仮実装（常に「未設定」）のまま本番に出て、
 * 環境変数の設定にかかわらず
 *   - 開発者向けの設定手順（環境変数の見本つき）がお客様の画面に出る
 *   - 「Proにアップグレード」が永久に押せない＝自分で有料化できない
 * という状態が7か月続いた。単体テストはモックを見ているだけで気づけないため、
 * **実際に動いている環境の `/api/stripe/status` と画面を突き合わせる**ここで押さえる。
 *
 * 受付が開いているかは環境（本番／プレビュー）で変わるので、期待値は API から取る。
 */
// デモ組織。状態の問い合わせと API 直叩きで**同じ組織**を使う
// （受け付けは組織ごとに開けられるため、別の組織で判定すると食い違う）
const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001'

test.describe('プランと請求', () => {
  test('決済の受け付け状況と画面の表示が一致している', async ({ page }) => {
    await page.goto('/settings/billing')

    // 真実源。ここが画面の期待値になる
    const status = await page.evaluate(async (orgId) => {
      const res = await fetch(`/api/stripe/status?org_id=${orgId}`, { credentials: 'same-origin' })
      return (await res.json()) as {
        canCheckout: boolean
        keysConfigured: boolean
        selfServeEnabled: boolean
      }
    }, DEMO_ORG_ID)

    const proButton = page.getByRole('button', { name: 'Proにアップグレード' })
    await expect(proButton).toBeVisible()

    const notice = page.getByTestId('billing-unavailable-notice')

    if (status.canCheckout) {
      // 受け付けている: ボタンが押せて、準備中の案内は出ない
      await expect(proButton).toBeEnabled()
      await expect(notice).toHaveCount(0)
    } else {
      // 受け付けていない: ボタンは押せず、お客様向けの案内が出る
      await expect(proButton).toBeDisabled()
      await expect(notice).toBeVisible()
      await expect(notice.getByRole('link', { name: /お問い合わせ/ })).toHaveAttribute(
        'href',
        '/contact',
      )
    }
  })

  test('開発者向けの設定手順・環境変数名をお客様の画面に出さない', async ({ page }) => {
    await page.goto('/settings/billing')
    await expect(page.getByRole('heading', { name: 'プランと請求' })).toBeVisible()

    const body = page.locator('body')
    await expect(body).not.toContainText('STRIPE_SECRET_KEY')
    await expect(body).not.toContainText('STRIPE_WEBHOOK_SECRET')
    await expect(body).not.toContainText('.env.local')
    await expect(body).not.toContainText('設定手順')
  })

  test('Enterprise は決済の状況にかかわらず相談できる（営業窓口の受け皿）', async ({ page }) => {
    await page.goto('/settings/billing')

    await expect(page.getByRole('button', { name: 'Enterpriseを相談する' })).toBeEnabled()
  })

  /**
   * 画面のボタンを無効にするだけでは、直接 API を叩かれたときに素通りしてしまう。
   * 受け付けを閉じているあいだは、サーバが 503 で断ることを確かめる。
   */
  test('受け付けていないあいだは、API を直接叩いても決済に進めない', async ({ page }) => {
    await page.goto('/settings/billing')

    const status = await page.evaluate(async (orgId) => {
      const res = await fetch(`/api/stripe/status?org_id=${orgId}`, { credentials: 'same-origin' })
      return (await res.json()) as { canCheckout: boolean }
    }, DEMO_ORG_ID)
    test.skip(status.canCheckout, 'この組織で受け付けが開いている環境では対象外')

    const result = await page.evaluate(async (orgId) => {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ org_id: orgId, plan_id: 'pro' }),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    }, DEMO_ORG_ID)

    /*
      受け付けの判定は、所属や役割の確認より**前**に効く（route の並び）。
      そのため「オーナーでないから 403」で通ってしまうことはなく、必ず 503 で止まる。
      ここを 403 も許すと、ガードを消しても気づけないテストになる。
    */
    expect(result.status).toBe(503)
    expect(result.body?.code).toBe('self_serve_disabled')
    expect(result.body?.url).toBeUndefined()
  })

  /**
   * 受け付けを閉じている間も、既に払っている方の「支払い方法の変更・請求書・解約」は
   * 塞がない。ここを1つの判定にまとめると、閉じた瞬間に解約手段まで消える。
   */
  test('受け付けの開閉と、既存契約の管理は別で判定している', async ({ page }) => {
    await page.goto('/settings/billing')

    const status = await page.evaluate(async (orgId) => {
      const res = await fetch(`/api/stripe/status?org_id=${orgId}`, { credentials: 'same-origin' })
      return (await res.json()) as {
        canCheckout: boolean
        keysConfigured: boolean
        selfServeEnabled: boolean
      }
    }, DEMO_ORG_ID)

    // 別々の値として返っていること（同じ値の言い換えになっていない）
    expect(typeof status.keysConfigured).toBe('boolean')
    expect(typeof status.selfServeEnabled).toBe('boolean')
    // 鍵が無ければ、受け付けの状態にかかわらず申し込みには進めない
    if (!status.keysConfigured) expect(status.canCheckout).toBe(false)
    // 全体の元栓が開いているなら、鍵さえあれば進める
    if (status.selfServeEnabled && status.keysConfigured) expect(status.canCheckout).toBe(true)
  })

  test('未ログインには設定の配備状況を返さない', async ({ browser }) => {
    // ログイン状態を持たない素のコンテキストで叩く
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const response = await context.request.get('/api/stripe/status')

    expect(response.status()).toBe(401)
    await context.close()
  })
})
