'use client'

import { useEffect, useMemo, useState } from 'react'

type ProfileRefillCelebrationProps = {
  pointsAwarded: number
}

const COLORS = ['#EF6F67', '#5DBB63', '#D39D2E', '#5BA5ED'] as const

export function ProfileRefillCelebration({ pointsAwarded }: ProfileRefillCelebrationProps) {
  const [visible, setVisible] = useState(pointsAwarded >= 5)

  useEffect(() => {
    setVisible(pointsAwarded >= 5)
  }, [pointsAwarded])

  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setVisible(false), 2200)
    return () => window.clearTimeout(timer)
  }, [visible])

  const pieces = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => ({
      id: i,
      left: `${(i / 41) * 100}%`,
      delay: `${(i % 9) * 45}ms`,
      duration: `${900 + (i % 7) * 80}ms`,
      color: COLORS[i % COLORS.length],
      rotate: `${(i % 2 === 0 ? 1 : -1) * (25 + (i % 6) * 8)}deg`,
    }))
  }, [])

  if (!visible) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-3 top-3 rounded-sm border border-[#b8d9b8] bg-[#eef8ee] px-2 py-1 text-[11px] font-semibold text-[#2f7b40]">
        +{pointsAwarded.toLocaleString()} points
      </div>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="absolute top-1 block h-2.5 w-1.5 rounded-[1px]"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            animationName: 'ea-confetti-fall',
            animationDuration: piece.duration,
            animationDelay: piece.delay,
            animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            animationFillMode: 'forwards',
            transform: `rotate(${piece.rotate})`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes ea-confetti-fall {
          0% { opacity: 0; transform: translateY(-14px) rotate(0deg); }
          10% { opacity: 1; }
          100% { opacity: 0; transform: translateY(170px) rotate(220deg); }
        }
      `}</style>
    </div>
  )
}
