import { test, expect } from './fixtures'

/**
 * 秘書の接続ページに出る「使い方（コマンド一覧）」。
 *
 * 発端の困りごとは「秘書をグループに入れたあと、タスクをどう片づけるのか分からない」。
 * 答え（`完了 3` と `一覧`）が**実際に画面に出て、貼り付け用の文章をコピーできる**ところまでを見る。
 *
 * 文言そのものの正しさはユニットテスト（commandGuides.test.ts）が見ているので、ここでは
 * **利用者の手で辿り着けるか**だけを確かめる（開ける・読める・コピーできる）。
 */

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const connectUrl = (channel: string) => `/${ORG_ID}/secretary/connect/${channel}`

/** 「使い方（コマンド一覧）」を開いて、開いたパネルを返す。 */
async function openGuide(page: import('@playwright/test').Page) {
  const guide = page.getByTestId('channel-command-guide')
  await expect(guide).toBeVisible()

  const toggle = guide.getByRole('button', { name: '使い方（コマンド一覧）' })
  // 閉じているときは中身をDOMに残さない作り。開く前に本文が無いことを確かめておく
  // （常時読み上げさせないための実装なので、壊れたら気づけるようにする）。
  await expect(guide.getByTestId('channel-command-guide-profile-text')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return guide
}

test.describe('秘書の接続ページ — 使い方（コマンド一覧）', () => {
  test('Discord: 元の困りごとへの答え（完了 と 一覧）が画面から読める', async ({ page }) => {
    await page.goto(connectUrl('discord'))
    const guide = await openGuide(page)

    // 片づけ方と、番号を見失ったときの逃げ道。この2つが読めれば発端の詰まりは解ける。
    await expect(guide.getByText('完了 3', { exact: true })).toBeVisible()
    await expect(guide.getByText('一覧', { exact: true })).toBeVisible()
    await expect(guide.getByText('タスク追加 見積もりを送る', { exact: true })).toBeVisible()
    await expect(guide.getByText('ヘルプ', { exact: true })).toBeVisible()
  })

  test('Discord: 貼り先は「トピック」と案内する（当社が持つ秘書はプロフィール欄を編集できない）', async ({
    page,
  }) => {
    await page.goto(connectUrl('discord'))
    const guide = await openGuide(page)

    // 実在するメニュー名で呼ぶ。ここが「プロフィール欄」だと貼り先が見つからず詰む。
    await expect(
      guide.getByText('チャンネルの「トピック」かピン留めしたメッセージに貼る文章', {
        exact: true,
      }),
    ).toBeVisible()
    // なぜ編集できないのかも添える（当社が持っている秘書なので事務所からは触れない）。
    await expect(guide.getByText(/秘書のプロフィール欄は当社が管理しています/)).toBeVisible()
    await expect(guide.getByText('秘書のプロフィール欄に貼る文章', { exact: true })).toHaveCount(0)
  })

  test('Slack: 事務所が自前で用意する秘書はプロフィール欄を貼り先にする（書き分けが効いている）', async ({
    page,
  }) => {
    await page.goto(connectUrl('slack'))
    const guide = await openGuide(page)

    await expect(guide.getByText('秘書のプロフィール欄に貼る文章')).toBeVisible()
  })

  test('貼り付け用の文章は、くわしい版と短い版の2つが出る', async ({ page }) => {
    await page.goto(connectUrl('discord'))
    const guide = await openGuide(page)

    const long = guide.getByTestId('channel-command-guide-profile-text')
    const short = guide.getByTestId('channel-command-guide-profile-short-text')
    await expect(long).toBeVisible()
    await expect(short).toBeVisible()

    // 短い版は字数の少ない欄に貼るためのもの。長い版より必ず短い。
    const longText = (await long.innerText()).trim()
    const shortText = (await short.innerText()).trim()
    expect(shortText.length).toBeLessThan(longText.length)
    // どちらにも片づけ方が入っている（短くしたときに答えを落とさない）。
    expect(longText).toContain('完了 3')
    expect(shortText).toContain('完了 3')
  })

  test('コピーボタンを押すと、画面に出ている文章がそのままクリップボードに入る', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(connectUrl('discord'))
    const guide = await openGuide(page)

    const shown = (await guide.getByTestId('channel-command-guide-profile-text').innerText()).trim()
    await guide.getByRole('button', { name: 'くわしい版をコピー' }).click()

    // 押した手応えが出る（無反応に見えないこと自体がこの画面の要件）。
    await expect(guide.getByRole('status')).toHaveText('コピーしました')

    const clipped = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipped.trim()).toBe(shown)
  })
})
