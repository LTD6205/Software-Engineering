'use client'
import Dropdown from './Dropdown'
import { useLang } from '@/context/LanguageContext'

// One combined time dropdown: pick hour AND minute together (e.g. "7:15",
// "7:30") in 15-minute steps — minutes are only ever 00/15/30/45. Value is an
// "HH:MM" 24-hour string to match the date/time form fields.
const SLOTS: { value: string; h: number; m: number }[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    SLOTS.push({ value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, h, m })
  }
}

export default function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { lang } = useLang()
  const loc = lang === 'vi' ? 'vi-VN' : 'en-US'
  const label = (h: number, m: number) =>
    new Date(2000, 0, 1, h, m).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', hour12: lang !== 'vi' })

  // Snap the current value to the nearest 15-min slot so it matches an option.
  const [rawH, rawM] = (value || '08:00').split(':').map(Number)
  let h = isNaN(rawH) ? 8 : rawH
  let q = isNaN(rawM) ? 0 : Math.round(rawM / 15) * 15
  if (q === 60) { q = 0; h = (h + 1) % 24 }
  const norm = `${String(h).padStart(2, '0')}:${String(q).padStart(2, '0')}`

  return (
    <Dropdown
      value={norm}
      onChange={onChange}
      ariaLabel="Time"
      options={SLOTS.map(s => ({ value: s.value, label: label(s.h, s.m) }))}
    />
  )
}
