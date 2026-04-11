'use client'

export function PrintDeckButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center justify-center rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
    >
      Print or Save PDF
    </button>
  )
}
