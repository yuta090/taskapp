/**
 * 日本時間の今日（YYYY-MM-DD）。アプリが前面に戻ったときに取り直す
 * （開いたまま日付をまたぐと、期限切れ・今日の分け方がずれるため。Web の /my も同じ）。
 */
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { jstNow } from '@/lib/datetime/jstNow'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export function useJstToday(): string {
  const [today, setToday] = useState(() => formatDateToLocalString(jstNow()))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(formatDateToLocalString(jstNow()))
    })
    return () => subscription.remove()
  }, [])
  return today
}
