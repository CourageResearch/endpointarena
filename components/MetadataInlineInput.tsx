'use client'

import { useEffect, useState } from 'react'

interface MetadataInlineInputProps {
  label: string
  initialValue: string
  placeholder: string
  onSave: (value: string) => Promise<void>
  className?: string
  inputType?: 'text' | 'date'
  highlightMissing?: boolean
}

export function MetadataInlineInput({
  label,
  initialValue,
  placeholder,
  onSave,
  className = '',
  inputType = 'text',
  highlightMissing = false,
}: MetadataInlineInputProps) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const saveValue = async () => {
    if (saving) return

    const nextValue = value.trim()
    const previousValue = initialValue.trim()

    if (nextValue === previousValue) {
      if (value !== nextValue) {
        setValue(nextValue)
      }
      return
    }

    setSaving(true)
    try {
      await onSave(nextValue)
    } finally {
      setSaving(false)
    }
  }

  const isMissing = highlightMissing && value.trim().length === 0
  const containerClassName = `flex min-w-[180px] items-center gap-2 rounded-none border px-2 py-1 text-xs ${
    isMissing
      ? 'border-[#c43a2b]/50 bg-[#c43a2b]/8 text-[#a13a31]'
      : 'border-[#e8ddd0] bg-[#F5F2ED] text-[#8a8075]'
  } ${className}`.trim()

  return (
    <label className={containerClassName}>
      <span className="w-[58px] shrink-0 uppercase tracking-[0.12em]">{label}</span>
      <input
        type={inputType}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          void saveValue()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }

          if (event.key === 'Escape') {
            setValue(initialValue)
            event.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        className={`min-w-0 flex-1 bg-transparent text-[#1a1a1a] outline-none ${
          isMissing ? 'placeholder:text-[#c88a82]' : 'placeholder:text-[#b5aa9e]'
        } ${inputType === 'date' ? 'pr-1' : ''}`}
      />
      {saving ? <span className="text-[10px] uppercase tracking-[0.12em] text-[#b5aa9e]">Saving</span> : null}
    </label>
  )
}
