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
    line: number;
    cells: string[];
}
export declare function parseCsv(text: string): CsvRecord[];
//# sourceMappingURL=csv.d.ts.map