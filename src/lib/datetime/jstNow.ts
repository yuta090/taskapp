/**
 * 実行環境のタイムゾーンに依存せず、JST（Asia/Tokyo）の現在日時「成分」を持つ Date を返す。
 *
 * なぜ必要か: 本番Vercelは既定でUTC。一方 due.ts 等の日付パーサは
 * now.getFullYear()/getMonth()/getDate()/getDay()/getHours() というローカル getter を使う。
 * 生の new Date() を渡すと、UTC環境では朝7時JST(=前日22時UTC)に日付が1日ずれ、
 * 「明日」「今週」「月末」の解決や毎朝配信の日付・retryKey が全て1日ずれる
 * （Codexレビューで確認された実バグ。DB側の extracted_date は
 *  `now() at time zone 'Asia/Tokyo'` で正しくJSTだが、JS側だけ生 new Date() だった）。
 *
 * jstNow() は JST成分を Intl で取り出し（既存 computeClientReminders.ts の確立パターン）、
 * それを new Date(y, m, d, h, min, s) で再構築する。これにより返り値の Date は
 * 「ローカル getter が JST値を返す」状態になり、既存パーサを無改修でTZ非依存にできる。
 *
 * 注意: 返り値の絶対時刻（getTime()/UTC）は真の現在時刻とは JSTオフセット分ずれる。
 * この Date は「日付成分の解決」専用であり、絶対時刻の記録には使わないこと。
 */
export function jstNow(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type)
    return p ? parseInt(p.value, 10) : 0
  }

  return new Date(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
}
