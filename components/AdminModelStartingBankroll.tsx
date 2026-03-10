import { MODEL_IDS, MODEL_INFO } from '@/lib/constants'

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function AdminModelStartingBankroll() {
  return (
    <section className="bg-white/80 border border-[#e8ddd0] rounded-none p-4">
      <h3 className="text-sm font-semibold text-[#1a1a1a] mb-2">Model Starting Bankroll</h3>
      <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        {MODEL_IDS.map((modelId) => (
          <div key={modelId} className="flex items-center justify-between border border-[#e8ddd0] rounded-none bg-white/70 p-2">
            <span className="text-[#8a8075]">{MODEL_INFO[modelId].fullName}</span>
            <span className="font-medium text-[#1a1a1a]">{formatMoney(100000)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
