import { describe, it, expect } from 'vitest'
import { computeSetupChecklist, type SetupChecklistData } from '@/lib/onboarding/computeSetupChecklist'

const SPACE_ID = 'space-1'
const ORG_ID = 'org-1'

const allFalse: SetupChecklistData = {
  hasNonSampleTask: false,
  hasTeamInvite: false,
  hasClientInvite: false,
  hasPublishedTask: false,
  hasPreviewedPortal: false,
  hasLineLinked: false,
  // 既定は「共通LINE開通済み（granted）＝ユーザーが自分で連携できる」状態でテストする。
  // requested/none/unavailable ケースは専用テストで lineAccess を渡す。
  lineAccess: 'granted',
  aiConfigured: false,
}

/** 全ステップ完了状態のデータ（LINE準備済み・連携済み・AI設定済み） */
const allTrue: SetupChecklistData = {
  hasNonSampleTask: true,
  hasTeamInvite: true,
  hasClientInvite: true,
  hasPublishedTask: true,
  hasPreviewedPortal: true,
  hasLineLinked: true,
  lineAccess: 'granted',
  aiConfigured: true,
}

describe('computeSetupChecklist', () => {
  it('LINE準備済みでは connect_line と configure_ai を含む7ステップになる', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)

    expect(result.steps.map((s) => s.key)).toEqual([
      'create_task',
      'invite_team',
      'invite_client',
      'publish_task',
      'preview_portal',
      'connect_line',
      'configure_ai',
    ])
    expect(result.totalCount).toBe(7)
    expect(result.completedCount).toBe(0)
    expect(result.allDone).toBe(false)
    for (const step of result.steps) {
      expect(step.done).toBe(false)
    }
  })

  it('create_task の案内は右上の「タスクを追加」ボタンを指す（一覧最下段の薄い行は見つけにくい）', () => {
    const r = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    expect(r.steps.find((s) => s.key === 'create_task')?.description).toContain('「タスクを追加」ボタン')
  })

  it('marks create_task done and gives it no CTA link (in-page action)', () => {
    const result = computeSetupChecklist({ ...allFalse, hasNonSampleTask: true }, SPACE_ID, ORG_ID)

    const step = result.steps.find((s) => s.key === 'create_task')!
    expect(step.done).toBe(true)
    expect(step.href).toBeNull()
    expect(result.completedCount).toBe(1)
  })

  it('gives invite_team a CTA link to /settings/members when undone, and clears it when done', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    const undoneStep = undone.steps.find((s) => s.key === 'invite_team')!
    expect(undoneStep.href).toBe('/settings/members')
    expect(undoneStep.ctaLabel).not.toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasTeamInvite: true }, SPACE_ID, ORG_ID)
    const doneStep = done.steps.find((s) => s.key === 'invite_team')!
    expect(doneStep.href).toBeNull()
    expect(doneStep.ctaLabel).toBeNull()
  })

  it('gives invite_client a CTA link to /settings/members when undone', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    const step = result.steps.find((s) => s.key === 'invite_client')!
    expect(step.href).toBe('/settings/members')
  })

  it('gives publish_task no CTA link (in-page action) regardless of done state', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    expect(undone.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasPublishedTask: true }, SPACE_ID, ORG_ID)
    expect(done.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()
  })

  it('points preview_portal at /portal/preview/{spaceId} when undone', () => {
    const result = computeSetupChecklist(allFalse, 'my-space-42', ORG_ID)
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBe('/portal/preview/my-space-42')
  })

  it('clears preview_portal CTA once previewed', () => {
    const result = computeSetupChecklist({ ...allFalse, hasPreviewedPortal: true }, SPACE_ID, ORG_ID)
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBeNull()
    expect(step.done).toBe(true)
  })

  describe('connect_line ステップ', () => {
    it('LINE秘書が準備済みで未連携なら、秘書コンソールへのCTAを持つ未完了ステップになる', () => {
      const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.done).toBe(false)
      expect(step.pending).not.toBe(true)
      expect(step.href).toBe(`/${ORG_ID}/secretary/connect/line`)
      expect(step.ctaLabel).not.toBeNull()
      // 手順だけでなく「連携すると何ができるか」(メリット)を説明文に含める
      expect(step.description).toContain('タスク')
      expect(step.description).toContain('承認')
    })

    it('未申込・申込中・準備中のどの状態でも、説明文に「何ができるか」(メリット)を含める', () => {
      for (const lineAccess of ['none', 'requested', 'unavailable'] as const) {
        const result = computeSetupChecklist({ ...allFalse, lineAccess }, SPACE_ID, ORG_ID)
        const step = result.steps.find((s) => s.key === 'connect_line')!
        expect(step.description, lineAccess).toContain('タスク')
        expect(step.description, lineAccess).toContain('承認')
      }
    })

    it('連携済みなら done かつ CTA なし', () => {
      const result = computeSetupChecklist({ ...allFalse, hasLineLinked: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.done).toBe(true)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
    })

    it('LINE秘書が未準備(準備中)なら pending 表示・CTAなし・進捗の分母に含めない', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccess: 'unavailable' }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.pending).toBe(true)
      expect(step.done).toBe(false)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
      // pending ステップ(connect_line)は表示はするが分母に含めない。
      // 分母は他6つ（create/invite_team/invite_client/publish/preview/configure_ai）。
      expect(result.totalCount).toBe(6)
    })

    it('準備中の文言は「当社が開通し、メールでご案内する」申込制モデルを明示する（自動で使えるようになる誤解を与えない）', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccess: 'unavailable' }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      // 運営が開通する主体であることと、能動的なご案内(メール)を約束する
      expect(step.description).toContain('当社')
      expect(step.description).toContain('ご案内')
      // 「ここから連携できます」= 待てば画面上で自動的に使えるという誤解を残さない
      expect(step.description).not.toContain('ここから連携できます')
    })

    it('準備中で他の実行可能ステップ(configure_ai含む)が完了なら allDone に到達できる（連携不能ステップで詰まらない）', () => {
      const result = computeSetupChecklist(
        {
          hasNonSampleTask: true,
          hasTeamInvite: true,
          hasClientInvite: true,
          hasPublishedTask: true,
          hasPreviewedPortal: true,
          hasLineLinked: false,
          lineAccess: 'unavailable',
          aiConfigured: true,
        },
        SPACE_ID,
        ORG_ID
      )
      expect(result.totalCount).toBe(6)
      expect(result.completedCount).toBe(6)
      expect(result.allDone).toBe(true)
    })

    it('lineAccess=none（未申込）なら申込CTAを持つ actionable ステップ（pendingでなく分母に含める）', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccess: 'none' }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.pending).not.toBe(true)
      expect(step.done).toBe(false)
      expect(step.href).toBe(`/${ORG_ID}/secretary/connect/line`)
      expect(step.ctaLabel).toContain('申し込')
      // 説明文は「何をしてくれるか」を簡潔に。申込手順の説明はCTAに任せる
      expect(step.description).toContain('タスク')
      expect(step.description).not.toContain('お申し込み')
      expect(result.totalCount).toBe(7)
    })

    it('連携済み(done)かつDM到達不能なら step.dmUnreachable が true（安全網の可視化）', () => {
      const result = computeSetupChecklist(
        { ...allFalse, hasLineLinked: true, dmUnreachable: true },
        SPACE_ID,
        ORG_ID
      )
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.done).toBe(true)
      expect(step.dmUnreachable).toBe(true)
    })

    it('連携済みだがDM到達不能でなければ step.dmUnreachable は false', () => {
      const result = computeSetupChecklist({ ...allFalse, hasLineLinked: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.dmUnreachable).toBe(false)
    })

    it('lineAccess=requested（申込中）なら pending・当社の開通待ち文言・分母から除外', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccess: 'requested' }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.pending).toBe(true)
      expect(step.done).toBe(false)
      expect(step.href).toBeNull()
      expect(step.description).toContain('受け付けました')
      expect(result.totalCount).toBe(6)
    })
  })

  describe('configure_ai ステップ（AI未設定の可視化）', () => {
    it('AI未設定なら未完了・設定画面へのCTAを持ち、自動タスク化が止まる旨を説明する', () => {
      const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'configure_ai')!
      expect(step.done).toBe(false)
      expect(step.pending).not.toBe(true)
      expect(step.href).toBe('/settings/org-integrations')
      expect(step.ctaLabel).not.toBeNull()
      // 「未設定だと自動タスク化されない」= サイレントに止まっていることを文言で可視化する
      expect(step.description).toContain('自動')
    })

    it('AI設定済みなら done かつ CTA なし', () => {
      const result = computeSetupChecklist({ ...allFalse, aiConfigured: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'configure_ai')!
      expect(step.done).toBe(true)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
    })
  })

  describe('クライアントなし（noClient）', () => {
    it('未招待かつ noClient でなければ invite_client に「クライアントなし」を選べる印(canMarkNoClient)が付く', () => {
      const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'invite_client')!
      expect(step.canMarkNoClient).toBe(true)
      expect(step.skipped).not.toBe(true)
    })

    it('noClient なら invite_client は skipped・分母から除外・招待リンクは残す（あとから招待できる）', () => {
      const result = computeSetupChecklist({ ...allFalse, noClient: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'invite_client')!
      expect(step.skipped).toBe(true)
      expect(step.done).toBe(false)
      expect(step.canMarkNoClient).not.toBe(true)
      expect(step.href).toBe('/settings/members')
      expect(step.ctaLabel).not.toBeNull()
      expect(step.description).toContain('クライアントなし')
    })

    it('noClient ならクライアント前提の publish_task / preview_portal も skipped・CTAなし', () => {
      const result = computeSetupChecklist({ ...allFalse, noClient: true }, SPACE_ID, ORG_ID)
      const publish = result.steps.find((s) => s.key === 'publish_task')!
      const preview = result.steps.find((s) => s.key === 'preview_portal')!
      expect(publish.skipped).toBe(true)
      expect(publish.href).toBeNull()
      expect(preview.skipped).toBe(true)
      expect(preview.href).toBeNull()
      expect(preview.ctaLabel).toBeNull()
      // 分母は create_task / invite_team / connect_line / configure_ai の4つ
      expect(result.totalCount).toBe(4)
      expect(result.completedCount).toBe(0)
    })

    it('noClient でも実際に完了していれば done が優先され skipped にならない', () => {
      const result = computeSetupChecklist(
        { ...allFalse, noClient: true, hasClientInvite: true, hasPublishedTask: true, hasPreviewedPortal: true },
        SPACE_ID,
        ORG_ID
      )
      for (const key of ['invite_client', 'publish_task', 'preview_portal'] as const) {
        const step = result.steps.find((s) => s.key === key)!
        expect(step.done).toBe(true)
        expect(step.skipped).not.toBe(true)
      }
      expect(result.totalCount).toBe(7)
      expect(result.completedCount).toBe(3)
    })

    it('noClient で残りの実行可能ステップが完了なら allDone に到達する（クライアント不在で詰まらない）', () => {
      const result = computeSetupChecklist(
        { ...allFalse, noClient: true, hasNonSampleTask: true, hasTeamInvite: true, hasLineLinked: true, aiConfigured: true },
        SPACE_ID,
        ORG_ID
      )
      expect(result.totalCount).toBe(4)
      expect(result.completedCount).toBe(4)
      expect(result.allDone).toBe(true)
      expect(result.currentStepKey).toBeNull()
    })

    it('skipped ステップは現在地にしない', () => {
      const result = computeSetupChecklist(
        { ...allFalse, noClient: true, hasNonSampleTask: true, hasTeamInvite: true },
        SPACE_ID,
        ORG_ID
      )
      expect(result.currentStepKey).toBe('connect_line')
    })
  })

  describe('この設定はしない（skipLine / skipAi）', () => {
    it('未連携・未設定なら connect_line / configure_ai に「この設定はしない」を選べる印(canSkip)が付く', () => {
      const r = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      expect(r.steps.find((s) => s.key === 'connect_line')?.canSkip).toBe(true)
      expect(r.steps.find((s) => s.key === 'configure_ai')?.canSkip).toBe(true)
    })

    it('未申込(none)でも connect_line に canSkip が付く（申込を迫られ続けない）', () => {
      const r = computeSetupChecklist({ ...allFalse, lineAccess: 'none' }, SPACE_ID, ORG_ID)
      expect(r.steps.find((s) => s.key === 'connect_line')?.canSkip).toBe(true)
    })

    it('skipLine なら connect_line は skipped・分母から除外・連携導線は残す', () => {
      const r = computeSetupChecklist({ ...allFalse, skipLine: true }, SPACE_ID, ORG_ID)
      const step = r.steps.find((s) => s.key === 'connect_line')!
      expect(step.skipped).toBe(true)
      expect(step.canSkip).toBeUndefined()
      expect(step.href).toBe(`/${ORG_ID}/secretary/connect/line`)
      expect(step.ctaLabel).toBe('連携する')
      expect(r.totalCount).toBe(6)
    })

    it('skipAi なら configure_ai は skipped・分母から除外・設定導線は残す', () => {
      const r = computeSetupChecklist({ ...allFalse, skipAi: true }, SPACE_ID, ORG_ID)
      const step = r.steps.find((s) => s.key === 'configure_ai')!
      expect(step.skipped).toBe(true)
      expect(step.href).toBe('/settings/org-integrations')
      expect(step.ctaLabel).toBe('設定する')
      expect(r.totalCount).toBe(6)
    })

    it('スキップ後に実際に連携・設定すれば done が優先される', () => {
      const r = computeSetupChecklist({ ...allFalse, skipLine: true, skipAi: true, hasLineLinked: true, aiConfigured: true }, SPACE_ID, ORG_ID)
      expect(r.steps.find((s) => s.key === 'connect_line')).toMatchObject({ done: true })
      expect(r.steps.find((s) => s.key === 'configure_ai')).toMatchObject({ done: true })
      expect(r.steps.some((s) => s.skipped)).toBe(false)
    })

    it('LINE も AI も「しない」＋クライアントなしで、残り2つが済めば allDone（設定しない人でも完了できる）', () => {
      const r = computeSetupChecklist(
        { ...allFalse, skipLine: true, skipAi: true, noClient: true, hasNonSampleTask: true, hasTeamInvite: true },
        SPACE_ID, ORG_ID,
      )
      expect(r.totalCount).toBe(2)
      expect(r.completedCount).toBe(2)
      expect(r.allDone).toBe(true)
    })

    it('申込中(requested)・準備中(unavailable)は skipLine に関係なく pending のまま', () => {
      for (const lineAccess of ['requested', 'unavailable'] as const) {
        const r = computeSetupChecklist({ ...allFalse, lineAccess, skipLine: true }, SPACE_ID, ORG_ID)
        const step = r.steps.find((s) => s.key === 'connect_line')!
        expect(step.pending).toBe(true)
        expect(step.skipped).toBeUndefined()
      }
    })
  })

  describe('currentStepKey（現在地）', () => {
    it('最初の未完了かつ実行可能なステップを指す', () => {
      const result = computeSetupChecklist({ ...allFalse, hasNonSampleTask: true }, SPACE_ID, ORG_ID)
      expect(result.currentStepKey).toBe('invite_team')
    })

    it('全完了なら null', () => {
      const result = computeSetupChecklist(allTrue, SPACE_ID, ORG_ID)
      expect(result.currentStepKey).toBeNull()
    })

    it('pending ステップは現在地にしない（完了不能なので飛ばす）', () => {
      const result = computeSetupChecklist(
        {
          hasNonSampleTask: true,
          hasTeamInvite: true,
          hasClientInvite: true,
          hasPublishedTask: true,
          hasPreviewedPortal: true,
          hasLineLinked: false,
          lineAccess: 'unavailable', // connect_line は pending
          aiConfigured: true,
        },
        SPACE_ID,
        ORG_ID
      )
      expect(result.currentStepKey).toBeNull()
    })
  })

  it('computes partial completion counts correctly', () => {
    const result = computeSetupChecklist(
      { ...allFalse, hasNonSampleTask: true, hasTeamInvite: true },
      SPACE_ID,
      ORG_ID
    )
    expect(result.completedCount).toBe(2)
    expect(result.allDone).toBe(false)
  })

  it('marks allDone true only when every applicable step is done', () => {
    const result = computeSetupChecklist(allTrue, SPACE_ID, ORG_ID)
    expect(result.totalCount).toBe(7)
    expect(result.completedCount).toBe(7)
    expect(result.allDone).toBe(true)
    for (const step of result.steps) {
      expect(step.href).toBeNull()
    }
  })
})
