/**
 * 議事録の「別の場所で更新されていた」失敗の型。
 *
 * なぜ hooks ではなくここに置くか:
 *  - 投げる側が 2 か所ある。①Web 保存の楽観ロックが 0 行だったとき(useMeetings)、
 *    ②タスク化の RPC が「渡された本文が今の本文と違う」と断ったとき(lib/supabase/rpc.ts)。
 *  - rpc.ts は useMeetings から呼ばれるので、rpc.ts が useMeetings を読み返すと循環になる。
 *    さらに画面のテストは '@/lib/hooks/useMeetings' をまるごと差し替える(モックする)ため、
 *    そこから型を取ると instanceof の判定が壊れる。
 * 受け取る側（画面）が instanceof で判定できるよう、どちらからも読める場所に1つだけ置く。
 * 既存の `import { MinutesConflictError } from '@/lib/hooks/useMeetings'` は、
 * useMeetings 側の再輸出でそのまま動く（同じクラスなので instanceof も一致する）。
 */
export class MinutesConflictError extends Error {
  constructor(message = 'この議事録は、別の場所で更新されています') {
    super(message)
    this.name = 'MinutesConflictError'
  }
}
