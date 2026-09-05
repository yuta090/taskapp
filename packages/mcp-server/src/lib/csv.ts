/**
 * 依存ゼロの CSV パーサ（RFC 4180 準拠の最小実装）。
 *
 * `agentpm task import` が受け取る CSV は Excel / Google スプレッドシートの書き出しが前提で、
 *   - 先頭の BOM
 *   - CRLF / LF / CR の改行
 *   - ダブルクォートで囲まれたセル内のカンマ・改行・"" エスケープ
 * を必ず含み得る。外部ライブラリを足すほどの量ではないのでここに閉じ込める。
 *
 * 返す各レコードには「そのレコードが始まった行番号(1始まり)」を持たせる。取り込み結果の
 * エラー報告で「CSVの何行目か」を人に示すためで、セル内改行があると単純な配列添字とは
 * ずれるためパーサ側で数える。
 */

export interface CsvRecord {
  /** レコードが始まる行番号（1始まり・ヘッダー行=1） */
  line: number
  cells: string[]
}

export function parseCsv(text: string): CsvRecord[] {
  let src = text
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)

  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordStartLine = 1
  let recordHasContent = false // 空行（セルもクォートも無い）を捨てるための印

  const pushCell = () => {
    cells.push(cell)
    cell = ''
  }
  const pushRecord = () => {
    pushCell()
    if (recordHasContent && cells.some((c) => c !== '')) {
      records.push({ line: recordStartLine, cells })
    }
    cells = []
    recordHasContent = false
    recordStartLine = line
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      recordHasContent = true
    } else if (ch === ',') {
      pushCell()
      recordHasContent = true
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      line++
      pushRecord()
    } else if (ch === '\n') {
      line++
      pushRecord()
    } else {
      cell += ch
      recordHasContent = true
    }
  }

  if (inQuotes) {
    throw new Error(`CSVの${recordStartLine}行目: ダブルクォートが閉じていません`)
  }
  // 末尾に改行が無い最終レコード
  pushRecord()

  return records
}
