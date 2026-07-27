/**
 * TASK6 記事の会話劇レンダリング。
 *
 * 記事本文(Markdown)では `**ガント**「セリフ」` という素の書式で会話を書く。
 * 本文はサニタイザを通るため執筆側では装飾できない——ここ(テンプレート側)で
 * サニタイズ済みHTMLの該当段落を検出し、丸アイコン付きの吹き出しへ変換する。
 * 挿入するHTMLはすべてこのファイル内のテンプレート文字列で、セリフ部分は
 * サニタイズ済みの断片をそのまま移し替えるだけなので安全性は変わらない。
 *
 * キャラクターの正本は docs/blog/MEDIA_DESIGN.md(ビジュアル確定)を参照。
 * 画像は公開バケット task6-covers/characters/ に配置済み(デプロイ不要で差し替え可)。
 */

export interface Task6Character {
  /** 画像ファイル名の元になるキー */
  key: 'gantt' | 'ivy' | 'yua'
  /** 吹き出し・紹介カードでの表示名 */
  displayName: string
  /** 紹介カードに出す一言(役割) */
  role: string
}

/** 本文中の話者名(太字部分) → キャラクター定義 */
export const TASK6_CHARACTERS: Record<string, Task6Character> = {
  ガント: { key: 'gantt', displayName: 'ガント先生', role: '全体を見わたす係。ガントチャートの考案者' },
  アイビー: { key: 'ivy', displayName: 'アイビー先生', role: '「明日やる6つ」を教えた実行の係' },
  ゆあ: { key: 'yua', displayName: 'ゆあ', role: 'いっしょに学ぶ新米社員。読者の代弁者' },
}

export function characterImageUrl(
  key: Task6Character['key'],
  variant: 'full' | 'face' = 'full',
): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const file = variant === 'face' ? `${key}-face.jpg` : `${key}.jpg`
  return `${base}/storage/v1/object/public/task6-covers/characters/${file}`
}

const SPEAKER_NAMES = Object.keys(TASK6_CHARACTERS)
  // 将来、特殊文字を含む話者名を足しても正規表現が壊れないようにエスケープ
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/**
 * `<p><strong>話者</strong>「セリフ」</p>` の段落だけを吹き出しへ変換する。
 * 鉤括弧の外に地の文が続く段落は会話として書かれていないので触らない。
 */
const DIALOGUE_RE = new RegExp(
  // セリフは同一段落内で完結させる(</p> をまたいで次の段落と誤結合しない)
  `<p><strong>(${SPEAKER_NAMES})</strong>「((?:(?!</p>)[\\s\\S])*?)」</p>`,
  'g',
)

const CHARACTERS_PLACEHOLDER_RE = /<p>\{\{characters\}\}<\/p>/g

// 色付きチャット枠は「AIっぽい」ため不採用(ユーザーフィードバック)。雑誌の対談レイアウトで組む。
function dialogueHtml(character: Task6Character, speechHtml: string): string {
  return (
    `<div class="not-prose my-7 flex items-start gap-4">` +
    `<div class="flex w-16 shrink-0 flex-col items-center">` +
    `<img src="${characterImageUrl(character.key, 'face')}" alt="${character.displayName}" width="64" height="64" loading="lazy" class="h-16 w-16 rounded-full object-cover" />` +
    `<span class="mt-1.5 text-[11px] font-bold tracking-wide text-slate-500">${character.displayName}</span>` +
    `</div>` +
    `<p class="min-w-0 pt-3 leading-loose text-slate-800">「${speechHtml}」</p>` +
    `</div>`
  )
}

function charactersCardHtml(): string {
  const cells = Object.values(TASK6_CHARACTERS)
    .map(
      (c) =>
        `<div class="flex flex-col items-center text-center">` +
        `<img src="${characterImageUrl(c.key)}" alt="${c.displayName}" width="144" height="144" loading="lazy" class="h-36 w-36 rounded-full object-cover" />` +
        `<p class="mt-4 text-base font-bold text-slate-900">${c.displayName}</p>` +
        `<p class="mt-1.5 text-sm leading-relaxed text-slate-500">${c.role}</p>` +
        `</div>`,
    )
    .join('')
  return `<div class="not-prose my-12 grid grid-cols-1 gap-10 py-4 sm:grid-cols-3">${cells}</div>`
}

/**
 * サニタイズ済みの記事HTMLに、TASK6の会話劇(吹き出し・キャラ紹介カード)を適用する。
 * 該当パターンが無ければ入力をそのまま返す。
 */
export function renderTask6BodyHtml(html: string): string {
  return html
    .replace(DIALOGUE_RE, (_m, name: string, speech: string) =>
      dialogueHtml(TASK6_CHARACTERS[name], speech),
    )
    .replace(CHARACTERS_PLACEHOLDER_RE, () => charactersCardHtml())
}
