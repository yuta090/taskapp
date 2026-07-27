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

export function characterImageUrl(key: Task6Character['key']): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/task6-covers/characters/${key}.jpg`
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

function dialogueHtml(character: Task6Character, speechHtml: string): string {
  return (
    `<div class="not-prose my-5 flex items-start gap-3">` +
    `<img src="${characterImageUrl(character.key)}" alt="${character.displayName}" width="48" height="48" loading="lazy" class="h-12 w-12 shrink-0 rounded-full border border-amber-200 bg-amber-50 object-cover" />` +
    `<div class="min-w-0 rounded-2xl rounded-tl-sm border border-amber-100 bg-amber-50/60 px-4 py-3">` +
    `<p class="text-xs font-bold text-amber-700">${character.displayName}</p>` +
    `<p class="mt-1 leading-relaxed text-slate-800">${speechHtml}</p>` +
    `</div></div>`
  )
}

function charactersCardHtml(): string {
  const cells = Object.values(TASK6_CHARACTERS)
    .map(
      (c) =>
        `<div class="flex flex-col items-center text-center">` +
        `<img src="${characterImageUrl(c.key)}" alt="${c.displayName}" width="80" height="80" loading="lazy" class="h-20 w-20 rounded-full border border-amber-200 bg-amber-50 object-cover" />` +
        `<p class="mt-2 text-sm font-bold text-slate-900">${c.displayName}</p>` +
        `<p class="mt-1 text-xs leading-relaxed text-slate-500">${c.role}</p>` +
        `</div>`,
    )
    .join('')
  return `<div class="not-prose my-8 grid grid-cols-1 gap-6 rounded-2xl border border-amber-100 bg-amber-50/50 p-6 sm:grid-cols-3">${cells}</div>`
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
