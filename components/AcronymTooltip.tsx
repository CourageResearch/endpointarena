'use client'

import { useState, useRef, useEffect } from 'react'

// FDA Acronym definitions
export const FDA_ACRONYMS: Record<string, { fullName: string; definition: string }> = {
  'BLA': {
    fullName: 'Biologics License Application',
    definition: 'FDA submission for biological products (vaccines, blood products, gene therapy)',
  },
  'NDA': {
    fullName: 'New Drug Application',
    definition: 'FDA submission for new pharmaceutical drugs',
  },
  'sNDA': {
    fullName: 'Supplemental NDA',
    definition: 'Amendment to existing NDA (new indication, dosage, etc.)',
  },
  'sBLA': {
    fullName: 'Supplemental BLA',
    definition: 'Amendment to existing BLA',
  },
  'ANDA': {
    fullName: 'Abbreviated New Drug Application',
    definition: 'FDA submission for generic drugs',
  },
  'PDUFA': {
    fullName: 'Prescription Drug User Fee Act',
    definition: 'Law requiring FDA decision deadlines; the "PDUFA date" is the target decision date',
  },
  'CRL': {
    fullName: 'Complete Response Letter',
    definition: 'FDA letter indicating application not approved; lists deficiencies',
  },
  'AdCom': {
    fullName: 'Advisory Committee',
    definition: 'Expert panel that reviews applications and votes on recommendations',
  },
  'EUA': {
    fullName: 'Emergency Use Authorization',
    definition: 'Expedited approval pathway during public health emergencies',
  },
  'NME': {
    fullName: 'New Molecular Entity',
    definition: 'Drug with active ingredient never before approved',
  },
  'RTF': {
    fullName: 'Refuse to File',
    definition: 'FDA determination that an application is incomplete and cannot be reviewed',
  },
  'IND': {
    fullName: 'Investigational New Drug',
    definition: 'Application to begin human clinical trials',
  },
}

interface AcronymTooltipProps {
  acronym: string
  children?: React.ReactNode
  className?: string
}

export function AcronymTooltip({ acronym, children, className = '' }: AcronymTooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState<'top' | 'bottom'>('top')
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const info = FDA_ACRONYMS[acronym]

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom

      // Show tooltip below if not enough space above (less than 100px)
      if (spaceAbove < 100 && spaceBelow > spaceAbove) {
        setPosition('bottom')
      } else {
        setPosition('top')
      }
    }
  }, [isVisible])

  if (!info) {
    return <span className={className}>{children || acronym}</span>
  }

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex items-center cursor-help ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onTouchStart={() => setIsVisible(true)}
      onTouchEnd={() => setTimeout(() => setIsVisible(false), 2000)}
    >
      <span className="border-b border-dotted border-zinc-500 hover:border-blue-400 transition-colors">
        {children || acronym}
      </span>

      {isVisible && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 w-64 px-3 py-2 text-left bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl ${
            position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          } left-1/2 -translate-x-1/2`}
        >
          {/* Arrow */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-800 border-zinc-700 transform rotate-45 ${
              position === 'top'
                ? 'bottom-[-5px] border-r border-b'
                : 'top-[-5px] border-l border-t'
            }`}
          />

          <div className="relative">
            <div className="text-xs font-semibold text-blue-400 mb-0.5">{acronym}</div>
            <div className="text-sm font-medium text-white mb-1">{info.fullName}</div>
            <div className="text-xs text-zinc-400 leading-relaxed">{info.definition}</div>
          </div>
        </div>
      )}
    </span>
  )
}

// Helper component to automatically wrap known acronyms in text
export function ApplicationTypeBadge({ type, className = '' }: { type: string; className?: string }) {
  const knownAcronyms = Object.keys(FDA_ACRONYMS)
  const isKnownAcronym = knownAcronyms.includes(type)

  if (isKnownAcronym) {
    return (
      <AcronymTooltip acronym={type}>
        <span className={`text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded ${className}`}>
          {type}
        </span>
      </AcronymTooltip>
    )
  }

  return (
    <span className={`text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded ${className}`}>
      {type}
    </span>
  )
}
