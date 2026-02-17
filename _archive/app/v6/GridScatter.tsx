'use client'

import type { ModelVariant } from '@/lib/constants'

interface GridScatterEvent {
  id: string
  drugName: string
  outcome: 'Approved' | 'Rejected'
  predictions: {
    model: ModelVariant
    predicted: 'approved' | 'rejected' | null
    correct: boolean | null
  }[]
}

const MODEL_COLORS: Record<ModelVariant, string> = {
  claude: '#F97316',
  gpt: '#10B981',
  grok: '#3B82F6',
}

const MODEL_LABELS: Record<ModelVariant, string> = {
  claude: 'Claude',
  gpt: 'GPT-5.2',
  grok: 'Grok',
}

export function GridScatter({ data }: { data: GridScatterEvent[] }) {
  const models: ModelVariant[] = ['claude', 'gpt', 'grok']

  return (
    <div
      className="relative p-4 sm:p-6 overflow-x-auto border border-[#e8ddd0]"
      style={{
        background: `
          repeating-linear-gradient(0deg, transparent, transparent 39px, #e8ddd0 39px, #e8ddd0 40px),
          repeating-linear-gradient(90deg, transparent, transparent 39px, #e8ddd0 39px, #e8ddd0 40px),
          #FAF5F0
        `,
        backgroundSize: '40px 40px',
      }}
    >
      {/* Column headers (drug names) */}
      <div className="flex gap-0 ml-16 sm:ml-20 mb-3">
        {data.map((event) => (
          <div
            key={event.id}
            className="w-[40px] shrink-0 text-center"
            title={event.drugName}
          >
            <span className="text-[9px] sm:text-[10px] text-[#8a8075] font-medium leading-none block truncate px-0.5">
              {event.drugName.split(' ')[0].substring(0, 5)}
            </span>
          </div>
        ))}
      </div>

      {/* Grid rows */}
      {models.map((model) => (
        <div key={model} className="flex items-center gap-0 mb-0">
          {/* Row label */}
          <div className="w-16 sm:w-20 shrink-0 pr-2 text-right">
            <span className="text-[10px] sm:text-xs font-medium" style={{ color: MODEL_COLORS[model] }}>
              {MODEL_LABELS[model]}
            </span>
          </div>

          {/* Squares */}
          <div className="flex gap-0">
            {data.map((event) => {
              const pred = event.predictions.find(p => p.model === model)
              const color = MODEL_COLORS[model]

              // No prediction for this event
              if (!pred || pred.predicted === null) {
                return (
                  <div
                    key={event.id}
                    className="w-[40px] h-[40px] flex items-center justify-center"
                    title={`${MODEL_LABELS[model]} — No prediction for ${event.drugName}`}
                  >
                    <div
                      className="w-4 h-4 sm:w-5 sm:h-5 border border-dashed"
                      style={{ borderColor: '#d4c9bc' }}
                    />
                  </div>
                )
              }

              // Correct prediction: filled square
              if (pred.correct) {
                return (
                  <div
                    key={event.id}
                    className="w-[40px] h-[40px] flex items-center justify-center"
                    title={`${MODEL_LABELS[model]} ✓ ${event.drugName} — Predicted ${pred.predicted}, FDA ${event.outcome}`}
                  >
                    <div
                      className="w-4 h-4 sm:w-5 sm:h-5"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                )
              }

              // Incorrect prediction: outline only
              return (
                <div
                  key={event.id}
                  className="w-[40px] h-[40px] flex items-center justify-center"
                  title={`${MODEL_LABELS[model]} ✗ ${event.drugName} — Predicted ${pred.predicted}, FDA ${event.outcome}`}
                >
                  <div
                    className="w-4 h-4 sm:w-5 sm:h-5 border-2"
                    style={{ borderColor: color, opacity: 0.5 }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-4 sm:gap-6 mt-4 ml-16 sm:ml-20 text-[10px] sm:text-[11px] text-[#8a8075]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#8a8075]" />
          <span>Correct</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 border-2 border-[#8a8075] opacity-50" />
          <span>Incorrect</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 border border-dashed border-[#d4c9bc]" />
          <span>No prediction</span>
        </div>
      </div>
    </div>
  )
}
