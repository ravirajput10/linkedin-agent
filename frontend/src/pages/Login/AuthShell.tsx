import type { ReactNode } from 'react'

import { ApiRequestError } from '@/services/client'

/** The centred card the signed-out screens share. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold text-ink">AI Engagement Agent</p>
          <p className="mt-0.5 text-xs text-ink-faint">Campaign &amp; workflow control</p>
        </div>

        <section className="rounded-lg border border-border-subtle bg-surface p-6 shadow-[0_1px_2px_rgba(18,21,26,0.04)]">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mb-5 mt-1 text-sm text-ink-muted">{subtitle}</p>}
          {!subtitle && <div className="mb-5" />}
          {children}
        </section>

        {footer && <p className="mt-4 text-center text-sm text-ink-muted">{footer}</p>}
      </div>
    </div>
  )
}

/**
 * A failed sign-in, in words.
 *
 * The server deliberately gives the same message for an unknown address and a
 * wrong password, so this must not try to be more specific than it is.
 */
export function AuthError({ error }: { error: unknown }) {
  if (!error) return null

  const message =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong. Try again.'

  const details = error instanceof ApiRequestError ? error.details : undefined
  const fieldErrors = Array.isArray(details?.errors)
    ? (details.errors as { loc?: unknown[]; msg?: string }[])
    : []

  return (
    <div
      role="alert"
      className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical"
    >
      <p>{message}</p>
      {fieldErrors.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs">
          {fieldErrors.map((item, index) => (
            <li key={index}>{item.msg ?? 'Invalid value'}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
