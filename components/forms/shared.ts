export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const FORM_FIELD_LABEL_CLASS = 'text-xs uppercase tracking-[0.16em] text-[#8a8075]'
export const FORM_INPUT_CLASS = 'h-11 w-full rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30'
export const FORM_TEXTAREA_CLASS = 'w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30'
export const FORM_ERROR_TEXT_CLASS = 'text-sm text-[#c24f45]'
export const PRIMARY_FORM_BUTTON_CLASS = 'ml-auto inline-flex h-11 items-center justify-center rounded-md bg-[#1a1a1a] px-5 text-sm font-medium text-white transition hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:bg-[#b5aa9e]'

export function getFormFeedbackClassName(isError: boolean): string {
  return `text-sm ${isError ? 'text-[#c24f45]' : 'text-[#5d8e60]'}`
}
