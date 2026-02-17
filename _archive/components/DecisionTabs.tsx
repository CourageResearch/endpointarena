'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow, BW2MobileUpcomingCard, BW2MobilePastCard } from '@/app/v2/rows'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'

interface SerializedEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string | null
  pdufaDate: string
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  predictions: {
    predictorId: string
    prediction: string
    confidence: number
    reasoning: string
    durationMs: number | null
    correct: boolean | null
  }[]
}

interface DecisionTabsProps {
  upcomingEvents: SerializedEvent[]
  pastEvents: SerializedEvent[]
}

export function DecisionTabs({ upcomingEvents, pastEvents }: DecisionTabsProps) {
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')

  const events = activeTab === 'upcoming' ? upcomingEvents : pastEvents
  const Row = activeTab === 'upcoming' ? BW2UpcomingRow : BW2PastRow
  const MobileCard = activeTab === 'upcoming' ? BW2MobileUpcomingCard : BW2MobilePastCard
  const emptyMessage = activeTab === 'upcoming' ? 'No upcoming decisions' : 'No decisions yet'
  const legendText = activeTab === 'upcoming'
    ? <><span style={{ color: '#7d8e6e' }}>{'↑'}</span> predicts approval · <span style={{ color: '#c07a5f' }}>{'↓'}</span> predicts rejection · Click any prediction to see reasoning</>
    : <><span style={{ color: '#7d8e6e' }}>{'✓'}</span> correct prediction · <span style={{ color: '#c07a5f' }}>{'✗'}</span> wrong prediction · Click any result to see reasoning</>

  return (
    <section className="mb-12 sm:mb-16">
      <div className="flex items-center justify-between mb-6 pb-2 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              activeTab === 'upcoming'
                ? 'bg-neutral-900 text-white'
                : 'bg-white text-neutral-400 hover:text-neutral-600'
            }`}
          >
            Upcoming ({upcomingEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('past')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              activeTab === 'past'
                ? 'bg-neutral-900 text-white'
                : 'bg-white text-neutral-400 hover:text-neutral-600'
            }`}
          >
            Past ({pastEvents.length})
          </button>
        </div>
        <Link href="/fda-calendar" className="text-xs text-neutral-400 hover:text-neutral-900">View all {'→'}</Link>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {events.map((event) => (
          <MobileCard key={event.id} event={event as any} />
        ))}
        {events.length === 0 && (
          <div className="border border-neutral-200 py-8 text-center text-neutral-400">{emptyMessage}</div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block border border-neutral-200 overflow-x-auto">
        <table className="w-full table-fixed min-w-[640px]">
          <colgroup>
            <col style={{width: '60px'}} />
            <col style={{width: '100px'}} />
            <col style={{width: '120px'}} />
            <col style={{width: '60px'}} />
            <col style={{width: '65px'}} />
            <col style={{width: '90px'}} />
            <col style={{width: '50px'}} />
            <col style={{width: '50px'}} />
            <col style={{width: '50px'}} />
          </colgroup>
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-400 text-xs uppercase tracking-wider">
              <th className="text-left px-3 py-3 font-medium">PDUFA</th>
              <th className="text-left px-3 py-3 font-medium">Drug</th>
              <th className="text-left px-3 py-3 font-medium">Company</th>
              <th className="text-left px-3 py-3 font-medium">Type</th>
              <th className="text-left px-3 py-3 font-medium">Ticker</th>
              <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-500" title="FDA"><FDAIcon /></div></th>
              <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Claude Opus 4.6"><ModelIcon id="claude" /></div></th>
              <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
              <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <Row key={event.id} event={event as any} />
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-neutral-100 text-[11px] text-neutral-400">
          {legendText}
        </div>
      </div>
    </section>
  )
}
