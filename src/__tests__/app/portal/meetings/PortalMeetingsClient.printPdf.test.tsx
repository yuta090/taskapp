import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalMeetingsClient } from '@/app/portal/meetings/PortalMeetingsClient'

// 相手先ポータルの議事録も「PDFで保存」できるようにする（社内の議事録・Wiki と同じ仕組み）。
// 押すとブラウザの印刷が開くだけで、紙に何を載せるかは globals.css の @media print が決める。
// 画面に置く目印:
//   data-print-root … このかたまりだけを紙に載せる（会議名・日時・サマリー・議事録の本文）
//   紙に載せないもの（「議事録詳細」の帯・閉じる・PDFのボタン）は、かたまりの外に置く
// 印刷の指定そのものは WikiPageClient.printPdf.test.tsx で検査している。

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal/meetings',
}))

// PortalLeftNav（PortalShell の中）が useCurrentUser を必ず呼ぶ
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

/** 画面が受け取る会議1件。空の議事録も渡せるよう、null を許す形で書く */
interface TestMeeting {
  id: string
  title: string
  heldAt: string | null
  status: string
  minutesMd: string | null
  summarySubject: string | null
  summaryBody: string | null
  startedAt: string | null
  endedAt: string | null
}

const MEETING: TestMeeting = {
  id: 'm1',
  title: 'キックオフミーティング',
  heldAt: '2026-09-18T10:00:00+09:00',
  status: 'ended',
  minutesMd: '# キックオフ\n\n- 開始日を決めた\n',
  summarySubject: '開始日が決まりました',
  summaryBody: '5月1日を納期とします',
  startedAt: '2026-09-18T10:00:00+09:00',
  endedAt: '2026-09-18T11:00:00+09:00',
}

const printMock = vi.fn()

function renderClient(meetings = [MEETING]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalMeetingsClient currentProject={project} projects={[project]} meetings={meetings} />
    </QueryClientProvider>
  )
}

/** 一覧のカードを押して、右の詳細パネルを開く */
function openMeeting(title = MEETING.title) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
}

beforeEach(() => {
  printMock.mockReset()
  // jsdom の window.print は呼ぶと「未実装」で落ちるので差し替える
  Object.defineProperty(window, 'print', { value: printMock, writable: true, configurable: true })
})

describe('PortalMeetingsClient — PDFで保存', () => {
  it('議事録を開くと「PDFで保存」ボタンが出る', () => {
    renderClient()
    openMeeting()

    expect(screen.getByRole('button', { name: 'PDFで保存' })).toBeInTheDocument()
  })

  it('押すと印刷の画面が開く', () => {
    renderClient()
    openMeeting()

    fireEvent.click(screen.getByRole('button', { name: 'PDFで保存' }))

    expect(printMock).toHaveBeenCalledTimes(1)
  })

  it('議事録が無い会議では出さない（刷るものが無いため）', () => {
    renderClient([{ ...MEETING, minutesMd: null, summarySubject: null, summaryBody: null }])
    openMeeting()

    expect(screen.queryByRole('button', { name: 'PDFで保存' })).not.toBeInTheDocument()
  })

  it('紙に載せるかたまりに、会議名・サマリー・議事録の本文が入っている', () => {
    renderClient()
    openMeeting()

    // 会議名は一覧のカードにも出ているので、かたまりの中だけを見る
    const printRoot = document.querySelector('[data-print-root]') as HTMLElement | null
    expect(printRoot).not.toBeNull()
    const inPrint = within(printRoot!)
    expect(inPrint.getByRole('heading', { name: MEETING.title })).toBeInTheDocument()
    expect(inPrint.getByText('開始日が決まりました')).toBeInTheDocument()
    expect(inPrint.getByText('開始日を決めた')).toBeInTheDocument()
  })

  it('パネルの帯（議事録詳細・閉じる・PDFのボタン）は紙に載せない', () => {
    renderClient()
    openMeeting()

    const printRoot = document.querySelector('[data-print-root]')
    expect(printRoot).not.toContainElement(screen.getByRole('button', { name: 'PDFで保存' }))
    expect(printRoot).not.toContainElement(screen.getByText('議事録詳細'))
  })
})
