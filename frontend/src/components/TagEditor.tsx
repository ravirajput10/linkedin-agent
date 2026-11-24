import { useState } from 'react'

import { Badge, Input } from '@/components/ui'

/**
 * Editable list of criteria terms.
 *
 * The campaign review screen is where the user confirms what the AI proposed,
 * so every list has to be directly editable — nothing the parser produces is
 * applied without a chance to change it.
 */
export function TagEditor({
  label,
  values,
  onChange,
  placeholder = 'Add and press Enter',
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const value = draft.trim()
    if (!value) return
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...values, value])
    setDraft('')
  }

  const remove = (value: string) => onChange(values.filter((item) => item !== value))

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-xs text-ink-faint">None yet</span>}
        {values.map((value) => (
          <Badge key={value} className="gap-1 pr-1">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => remove(value)}
              className="ml-0.5 rounded-full px-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <Input
        className="mt-2"
        value={draft}
        placeholder={placeholder}
        aria-label={`Add to ${label}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
  )
}
