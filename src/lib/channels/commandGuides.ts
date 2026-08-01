import type { ChannelId } from '@/lib/channels/registry'

/**
 * チャットごとの「秘書の使い方」— 単一の真実源。
 *
 * 秘書はグループに入って会話からやることを拾うのに、**利用者向けの使い方案内がどこにも
 * 無かった**（「Discord でタスクをどう終わりにするのか分からない」）。案内を出す先は3つある:
 *   (a) 各チャットの秘書のプロフィール欄／グループの説明にあたる欄に貼る短い文章
 *   (b) チャット内で「ヘルプ」と送られたときの返信
 *   (c) 秘書の接続ページに出す使い方パネル
 * 3つに別々の文章を書くと必ずズレるので、**このファイル1つから3つとも作る**。
 *
 * ⚠ ここは説明文のみ。接続の可否・アダプタの能力・DBのcheck制約は registry.ts が真実源
 *   （ツール連携の setupGuides.ts が registry.ts に対して取っているのと同じ役割分離）。
 * ⚠ 例文（'完了 3' など）は本物の合図でなければならない。テストが実際の読み取り関数
 *   （parseDigestCompleteCommand / parseHelpCommand / parseAddTaskCommand）に通して検証する。
 *
 * 言葉づかいの約束（守らないと読み手が混乱する）:
 *   - **タスクを終わらせる操作は「完了にする」**。秘書の実際の返事が「『○○』を完了にしました。」
 *     なので、案内だけ「片づける」と言うと同じ操作に2つの名前が付く。
 *   - **やり直しは「元に戻す」**。「取り消す」は LINE のボタンの名前としてだけ使う。
 *     同じ本文で「取り消せません」と「[取り消す]を押すと戻せます」を両方言うと正面から矛盾する。
 *   - **打てない言葉を動詞で誘わない**（合図でない「やめる」で誘わない、など）。
 *   - **「一覧」は打つ合図の名前だけに使う。定期的に届くものは「お知らせ」と呼ぶ**。
 *     ⚠ ここを混ぜると1通の中で意味が正面衝突する。実際に起きていた壊れ方:
 *     注意書きが「番号は一覧を作り直すたびに付け直します」と読め、**合図の「一覧」は
 *     番号を1つも動かさない**（groupCommands.buildTaskListReplyText）のに、打つと番号が
 *     変わると受け取られていた。番号を付け直すのは配信直前のお知らせ側だけ。
 *   - **初めて読む人に合わせる**。ヘルプは初回にも読まれるので「もう一度」と言わない。
 *   - **指示語で済ませない**。「そのタスク」は何を指すか分からない（「その行のタスク」と書く）。
 */

/** 利用者が打つ1コマンド。 */
export interface ChatCommandEntry {
  /** 実際に打つ文字列（画面では等幅で見せる）。ボタン操作など「打つもの」が無ければ null */
  input: string | null
  /** 何が起きるか（1文・です/ます） */
  effect: string
  /** 貼り先の入力欄が狭いとき用の短い言い方。無ければ effect をそのまま使う */
  shortEffect?: string
  /** 補足（任意・1行） */
  note?: string
  /**
   * 貼り付け用の文章（プロフィール欄・説明欄）には載せない合図。
   *
   * 貼り先の入力欄には字数の上限があり、**毎日使う合図**を優先して入れたい。
   * 「練習」は困った人の受け皿で、そこへは『ヘルプ』の返事から辿り着ける
   * （貼り紙 → ヘルプ → 練習）。日々の合図を押し出してまで貼り紙に載せない。
   */
  omitFromProfile?: boolean
}

/** 1チャネル分の使い方。ここから3つの出力（プロフィール欄／チャット返信／接続ページ）を作る。 */
export interface ChannelCommandGuide {
  channel: ChannelId
  /** このチャットで秘書に何ができるか（1〜2文） */
  summary: string
  /** 入力欄が狭い貼り先のための1文 */
  summaryShort: string
  /** 打てるコマンド。並び順＝困ったときに探す順（完了 → 一覧 → タスク追加 → ヘルプ） */
  commands: ChatCommandEntry[]
  /** できないこと・気をつけること */
  limitations: string[]
}

/**
 * チャネルごとの差。ここだけ書けばガイド3種が揃う。
 * 7チャネル分の説明文をコピーしないための唯一の仕掛け（過剰な抽象化はしない）。
 */
export interface ChannelCommandTraits {
  /** 「完了N」が効くか（parseDigestCompleteCommand の配線と必ず一致させる） */
  complete: boolean
  /** 「一覧」が効くか（未完了のタスクを番号付きで返す） */
  list: boolean
  /** 「タスク追加 ○○」が効くか */
  addTask: boolean
  /** 「ヘルプ」が効くか */
  help: boolean
  /** 「練習」が効くか（使い方の練習をもう一度やる） */
  practice: boolean
  /** 押せるボタンが届くか（現状 LINE のみ true） */
  buttons: boolean
  /**
   * 先頭に付いた秘書あてのメンションを取り除いてから合図を読むか。
   * ⚠ ここに '@秘書の名前' のような見本を持たせない。見本を書くと、その文字列を
   *   そのまま打ってしまう人が出る（メンションは入力補助から選ぶもの）。
   */
  mentionTolerant: boolean
  /**
   * 相手先の誰でも書き込める貼り先の**実際のメニュー名**。
   * 「グループの説明欄」と全チャット同じ言い方をすると、その名前のメニューが無くて探せない。
   */
  sharedPasteTarget: string
  /**
   * 短い版にも必ず残す、そのチャットだけの致命的な注意（1行・短く）。
   *
   * 入れてよいのは**日々の合図がまるごと効かなくなるもの**だけ（Chatwork の「返信」ボタンなど）。
   * つなぐときにしか関係しない注意（Google Chat の最初の合言葉など）は、
   * 事務所の方が読む長い版と画面に任せる。短い版は貼れる字数がとても少ない。
   */
  shortCriticalNote?: string
  /** そのチャネル固有の注意（任意・1行ずつ） */
  extraLimitations?: string[]
}

/**
 * whatsapp / messenger は group:false の1:1専用で、グループの申し送りタスク自体が存在しない
 * （＝「完了N」も未配線）。email は送受信の対象外。**存在しない操作を案内しない**ため、
 * これらにはガイドを置かない（getChannelCommandGuide が null を返し、呼び出し側はボタンごと出さない）。
 */
export const CHANNEL_COMMAND_TRAITS: Partial<Record<ChannelId, ChannelCommandTraits>> = {
  line: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: true,
    mentionTolerant: true,
    sharedPasteTarget: 'グループの「ノート」',
  },
  slack: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: true,
    sharedPasteTarget: 'チャンネルの「説明」',
  },
  discord: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: true,
    sharedPasteTarget: 'チャンネルの「トピック」',
  },
  chatwork: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: false,
    sharedPasteTarget: 'グループチャットの「概要」',
    shortCriticalNote: '「返信」ボタンでは合図として読み取れません。',
    extraLimitations: [
      'Chatworkの「返信」ボタンを使うと、お名前が文の先頭に入って合図として読み取れません。「完了 3」だけを送ってください。',
    ],
  },
  telegram: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: true,
    sharedPasteTarget: 'グループの「説明」',
  },
  teams: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: true,
    sharedPasteTarget: 'チャネルの「説明」',
  },
  google_chat: {
    complete: true,
    list: true,
    addTask: true,
    help: true, practice: true,
    buttons: false,
    mentionTolerant: true,
    sharedPasteTarget: 'スペースの「説明」',
    extraLimitations: [
      '最初に合言葉を送るときだけ、秘書あてのメンションを付けてください。付いていないと届きません。',
    ],
  },
}

// ---- 繰り返す文言は定数にする（setupGuides.ts の PICK_TARGET_SPACE と同じ作法） ----

/**
 * ⚠ 「一覧」と書かない。定期的に届くものは「お知らせ」と呼ぶ（合図の「一覧」と意味が割れるため）。
 */
const SUMMARY = 'タスクを預かる秘書です。この会話から「やること」を拾って、番号を付けてお知らせします。'
const SUMMARY_SHORT = 'この会話からやることを拾う秘書です。'

/** 「一覧」は別担当が実装中の合図。案内と実装で綴りがズレないよう、ここを見て配線する。 */
export const LIST_COMMAND_INPUT = '一覧'

/**
 * ⚠ 例文には**必ず区切りの空白を入れる**。「完了 3」は空白があってもなくても効くが、
 *   「タスク追加」は空白が無いと読み取れない。空白を入れない例文を1つでも混ぜると、
 *   読み手が「空白は要らない」という規則を覚えてしまい、タスク追加で無反応になる。
 */
const INPUT_COMPLETE = '完了 3'
const INPUT_LIST = LIST_COMMAND_INPUT
const INPUT_ADD_TASK = 'タスク追加 見積もりを送る'
const INPUT_HELP = 'ヘルプ'
const INPUT_PRACTICE = '練習'

const EFFECT_COMPLETE = 'その番号のタスクを完了にします'
const SHORT_EFFECT_COMPLETE = 'その番号を完了にします'
const EFFECT_LIST = '終わっていないタスクを番号付きでお送りします'
const SHORT_EFFECT_LIST = '残りのタスクを番号付きで出します'
const EFFECT_ADD_TASK = 'その場でタスクを1件お預かりします'
const SHORT_EFFECT_ADD_TASK = '1件お預かりします'
/**
 * ⚠ 「もう一度」と書かない。ヘルプは**初めて使う人が最初に打つ**ことがいちばん多い合図で、
 *   1度も見ていない人に「もう一度お送りします」と言うと引っかかる。
 */
const EFFECT_HELP = '使い方をお送りします'
const SHORT_EFFECT_HELP = '使い方を出します'
const EFFECT_PRACTICE = 'タスクの登録と完了を、その場で練習できます'
/**
 * LINE にだけ届く押せるボタン。
 * ⚠ [取り消す] の説明をここにも書かない。同じ話を注意書き（LIMIT_UNDO_LINE）で言い直すことになり、
 *   1通の中で同じ文が2回出る。押し方は注意書き側にまとめる。
 * ⚠ 「そのタスク」と書かない。お知らせにはタスクが何行も並ぶので、どれのことか分からない。
 */
const EFFECT_BUTTON_DONE = 'お知らせに並ぶボタンを押しても、その行のタスクを完了にできます'

/**
 * 「完了 3」の 3 がどこの数字なのか。**番号が無いと動かない**ことまで書く。
 * 「完了」とだけ送っても無反応（parseDigestCompleteCommand が数字を必須にしている）で、
 * 番号に触れずに「『完了』と送ってください」とだけ書くと案内が嘘になる。
 */
const NOTE_NUMBER_PLACE = '「3」は、お知らせに並ぶタスクの先頭に付いている番号です。番号を付けないと動きません。'

/** 番号が分からなくなった人の逃げ道。ここが無いと「完了 3」に進めない。 */
const NOTE_LIST_WHEN = '番号が分からなくなったときに使ってください。'

/**
 * 「タスク追加」だけは区切りの空白が要る（parseAddTaskCommand が1文字以上を必須にしている）。
 * 「タスク追加見積もりを送る」は無反応になるので、例文任せにせず言葉でも書く。
 */
const NOTE_ADD_TASK_SPACE = '「タスク追加」と内容のあいだに、空白を1つ入れてください。'

/**
 * 注意書きの先頭。**否定文から書き始めない** — 探している人が最初に「できません」に
 * ぶつかると、答えにたどり着く前に読むのをやめてしまう。
 * 送り方そのものは合図の一覧が答えているので、ここでは繰り返さない。
 *
 * ⚠ 番号のふり直しは「毎朝」ではない。お知らせを作り直すたび（日中も）に起き、並びは期限順なので
 *   1件足りただけで総入れ替えになりうる。時刻を書くと「朝の番号は今日いっぱい使える」と
 *   誤解させ、別のタスクを完了にさせてしまう。**時刻を断定せず、いちばん新しいものを基準にする**。
 *
 * ⚠ 付け直しの引き金として「一覧」を書かない。合図の「一覧」は番号を1つも動かさず、いまの番号を
 *   そのまま出すだけ（groupCommands.buildTaskListReplyText）。ここに書くと実装と正反対になり、
 *   「打つと番号が変わるなら怖くて打てない」と読ませてしまう。番号を確かめる逃げ道として挙げる。
 */
const LIMIT_RENUMBER =
  '番号は、お知らせをお届けするたびに付け直します。いちばん新しいお知らせか「一覧」の番号で送ってください。'

/** 秘書あてメンションの扱い。先頭のメンションは合図の読み取り前に取り除かれる。 */
const LIMIT_MENTION = '先頭に秘書あてのメンションが付いていても、そのまま読み取ります。'

const LIMIT_UNDO_LINE =
  '間違えて完了にしたときは、完了のお知らせに出る[取り消す]を24時間以内に押すと元に戻せます。'

/**
 * ⚠ この文章を読むのは相手先の担当者で、**秘書の画面を持っていない**。
 *   「画面から戻してください」と書いても実行できないので、頼む相手を書く。
 *   社内用語（コンソール）も利用者向け文面には出さない。
 */
const LIMIT_UNDO_OTHER =
  '間違えて完了にしたときは、このグループに秘書を入れた担当の方にお伝えください。その方の画面から元に戻せます。'

function buildGuide(channel: ChannelId, traits: ChannelCommandTraits): ChannelCommandGuide {
  const commands: ChatCommandEntry[] = []

  // 並び順＝困っている順。発端の困りごとが「どう終わりにするか」なので完了を先頭に置き、
  // その番号が分からない人の逃げ道（一覧）をすぐ隣に置く。
  if (traits.complete) {
    commands.push({
      input: INPUT_COMPLETE,
      effect: EFFECT_COMPLETE,
      shortEffect: SHORT_EFFECT_COMPLETE,
      note: NOTE_NUMBER_PLACE,
    })
  }
  if (traits.list) {
    commands.push({
      input: INPUT_LIST,
      effect: EFFECT_LIST,
      shortEffect: SHORT_EFFECT_LIST,
      note: NOTE_LIST_WHEN,
    })
  }
  if (traits.addTask) {
    commands.push({
      input: INPUT_ADD_TASK,
      effect: EFFECT_ADD_TASK,
      shortEffect: SHORT_EFFECT_ADD_TASK,
      note: NOTE_ADD_TASK_SPACE,
    })
  }
  if (traits.help) {
    commands.push({ input: INPUT_HELP, effect: EFFECT_HELP, shortEffect: SHORT_EFFECT_HELP })
  }
  // 練習は「読んでも分からなかった人」の受け皿なので、ヘルプの次に置く。
  if (traits.practice) {
    commands.push({ input: INPUT_PRACTICE, effect: EFFECT_PRACTICE, omitFromProfile: true })
  }
  if (traits.buttons) {
    // 押すだけで打つ文字列が無い操作。プロフィール欄（打つ合図の一覧）には出さない。
    commands.push({ input: null, effect: EFFECT_BUTTON_DONE })
  }

  const limitations: string[] = []
  if (traits.complete) limitations.push(LIMIT_RENUMBER)
  if (traits.mentionTolerant) limitations.push(LIMIT_MENTION)
  limitations.push(traits.buttons ? LIMIT_UNDO_LINE : LIMIT_UNDO_OTHER)
  if (traits.extraLimitations) limitations.push(...traits.extraLimitations)

  return { channel, summary: SUMMARY, summaryShort: SUMMARY_SHORT, commands, limitations }
}

function findTraits(channel: string): { id: ChannelId; traits: ChannelCommandTraits } | null {
  const traits = (CHANNEL_COMMAND_TRAITS as Record<string, ChannelCommandTraits | undefined>)[channel]
  return traits ? { id: channel as ChannelId, traits } : null
}

/** 構造化ガイド。無ければ null（呼び出し側はボタンごと出さない）。 */
export function getChannelCommandGuide(channel: string): ChannelCommandGuide | null {
  const found = findTraits(channel)
  return found ? buildGuide(found.id, found.traits) : null
}

/**
 * 長い版の上限。秘書のプロフィール欄やピン留めのメッセージに貼る前提の長さ。
 * これを超えたら、案内が説明書になりかけている合図（読まれなくなる）。
 * 字数の少ない欄は短い版に任せる。
 */
export const BOT_PROFILE_TEXT_MAX_LENGTH = 450

/**
 * 入力欄が狭い貼り先のための上限。
 * スペースの説明欄のように150字前後しか入らない欄があるので、そこに収まる長さにする。
 */
export const BOT_PROFILE_SHORT_TEXT_MAX_LENGTH = 130

/** 合図1行（`・完了 3 … その番号のタスクを完了にします`）。 */
function renderCommandLine(command: ChatCommandEntry): string {
  return command.input ? `・${command.input} … ${command.effect}` : `・${command.effect}`
}

/**
 * (a) 秘書のプロフィール欄や、グループの説明にあたる欄に貼るテキスト。
 * 装飾なし・BOT_PROFILE_TEXT_MAX_LENGTH 以内。
 * 「打つ合図」だけを並べる（ボタン操作は貼っても押せないため出さない）。
 * 補足（番号の在りか・区切りの空白）は、画面を持たない相手先が読む文章なので必ず載せる。
 */
export function renderBotProfileText(channel: string): string | null {
  const guide = getChannelCommandGuide(channel)
  if (!guide) return null
  const lines = [guide.summary]
  for (const command of guide.commands) {
    if (!command.input || command.omitFromProfile) continue
    lines.push(renderCommandLine(command))
    if (command.note) lines.push(`　${command.note}`)
  }
  for (const limitation of guide.limitations) {
    lines.push(`※${limitation}`)
  }
  return lines.join('\n')
}

/**
 * (a-2) 入力欄が狭い貼り先のための短い版。
 *
 * 長い版が入りきらない欄があるため、**打つ合図**に絞る。ただし、
 * **そのチャットだけの致命的な注意（shortCriticalNote）は落とさない**。
 * Chatwork の「返信」ボタンのように、知らずに踏むと合図が一切効かないものを削ると、
 * 短い版を貼ったグループだけ秘書が動かないように見える。
 */
export function renderBotProfileShortText(channel: string): string | null {
  const found = findTraits(channel)
  if (!found) return null
  const guide = buildGuide(found.id, found.traits)
  const lines = [guide.summaryShort]
  for (const command of guide.commands) {
    if (!command.input || command.omitFromProfile) continue
    lines.push(`・${command.input} … ${command.shortEffect ?? command.effect}`)
  }
  if (found.traits.shortCriticalNote) lines.push(`※${found.traits.shortCriticalNote}`)
  return lines.join('\n')
}

/** (b) チャット内「ヘルプ」への返信本文。 */
export function renderHelpReplyText(channel: string): string | null {
  const guide = getChannelCommandGuide(channel)
  if (!guide) return null
  const commandLines = guide.commands
    .flatMap((command) => (command.note ? [renderCommandLine(command), `　${command.note}`] : [renderCommandLine(command)]))
    .join('\n')
  const limitationLines = guide.limitations.map((limitation) => `※${limitation}`).join('\n')
  return `${guide.summary}\n\n${commandLines}\n\n${limitationLines}`
}

// ---- 貼り先の呼び名 ----

/** 秘書のアカウントの持ち主。'platform' = 当社が用意した秘書 / 'org' = 事務所が登録した秘書 */
export type SecretaryAccountOwner = 'platform' | 'org'

export interface ChannelPastePlacement {
  /** 貼り先を言い切る見出し */
  heading: string
  /** なぜそこに貼るのか（1文） */
  note: string
}

const OWN_PLACEMENT: ChannelPastePlacement = {
  heading: '秘書のプロフィール欄に貼る文章',
  note: '相手先の方がいつでも読めるように、この文章を秘書のプロフィール欄に貼っておいてください。',
}

/**
 * (c) どこに貼ってもらうかの言い方。**チャットごとに実際のメニュー名で呼ぶ**。
 *
 * 当社が用意した秘書（Discord / Google Chat / 共通LINE）のプロフィール欄は事務所の方が
 * 編集できない。代わりに相手先の誰でも書ける場所へ貼ってもらうが、その場所の名前は
 * チャットごとに違う（Discord は「トピック」、LINE は「ノート」…）。全部を「説明欄」と
 * 呼ぶと、そのメニューが見つからず貼れない。
 */
export function getChannelPastePlacement(
  channel: string,
  owner: SecretaryAccountOwner,
): ChannelPastePlacement | null {
  const found = findTraits(channel)
  if (!found) return null
  if (owner === 'org') return OWN_PLACEMENT
  const target = found.traits.sharedPasteTarget
  return {
    heading: `${target}かピン留めしたメッセージに貼る文章`,
    note: `秘書のプロフィール欄は当社が管理しています。相手先の方がいつでも読めるように、${target}か、ピン留めしたメッセージに貼っておいてください。`,
  }
}
