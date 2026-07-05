'use client'

const PAD = 8

interface WalkthroughBackdropProps {
  /** Spotlight target rect; null renders a full-screen dimmer (centered-dialog mode). */
  targetRect: DOMRect | null
  onClose: () => void
}

/**
 * Dimmed backdrop for the walkthrough. In spotlight mode it is built from
 * four rects surrounding the target's padded hole: the dimmed area must
 * block clicks from reaching the UI underneath (closing the tour instead),
 * while the hole stays uncovered so the user can actually click the
 * spotlighted element.
 */
export function WalkthroughBackdrop({ targetRect, onClose }: WalkthroughBackdropProps) {
  if (!targetRect) {
    return (
      <div
        data-testid="walkthrough-backdrop"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />
    )
  }

  const holeTop = Math.max(0, targetRect.top - PAD)
  const holeLeft = Math.max(0, targetRect.left - PAD)
  const holeBottom = targetRect.top + targetRect.height + PAD
  const holeRight = targetRect.left + targetRect.width + PAD

  const rects: React.CSSProperties[] = [
    { top: 0, left: 0, right: 0, height: holeTop },
    { top: holeBottom, left: 0, right: 0, bottom: 0 },
    { top: holeTop, left: 0, width: holeLeft, height: holeBottom - holeTop },
    { top: holeTop, left: holeRight, right: 0, height: holeBottom - holeTop },
  ]

  return (
    <>
      {rects.map((style, i) => (
        <div
          key={i}
          data-testid="walkthrough-backdrop"
          className="fixed bg-black/50 pointer-events-auto transition-all duration-200"
          style={style}
          onClick={onClose}
        />
      ))}
    </>
  )
}
