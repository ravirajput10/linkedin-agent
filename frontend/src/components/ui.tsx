import clsx from 'clsx'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/* -------------------------------------------------------------- primitives */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary:
    'bg-surface text-ink border border-border-subtle hover:bg-surface-muted disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:text-ink-faint',
  danger: 'bg-critical text-white hover:bg-red-800 disabled:bg-red-300',
}

export function Button({
  variant = 'secondary',
  className,
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={clsx(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  )
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={clsx(
        'rounded-lg border border-border-subtle bg-surface shadow-[0_1px_2px_rgba(18,21,26,0.04)]',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
        className,
      )}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
        className,
      )}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm text-ink',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
        className,
      )}
    >
      {children}
    </select>
  )
}

export function Checkbox({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 rounded border-border-subtle text-accent focus:ring-2 focus:ring-accent/20"
      />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </span>
    </label>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={clsx('flex flex-col justify-start', className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-muted select-none">
        {label}
      </span>
      <div className="w-full">{children}</div>
      {hint && <span className="mt-1 block text-xs text-ink-faint leading-tight">{hint}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ status */

type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-ink-muted',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const STATUS_TONES: Record<string, Tone> = {
  // Dry-run outcomes must never read like something that happened.
  WOULD_LIKE: 'caution',
  WOULD_COMMENT: 'caution',
  RUNNING: 'positive',
  COMPLETED: 'positive',
  APPROVED: 'positive',
  CONNECTION_SENT: 'positive',
  DRAFT: 'neutral',
  READY: 'accent',
  SCHEDULED: 'accent',
  PENDING: 'caution',
  PAUSED: 'caution',
  WAITING_FOR_CONNECTION: 'caution',
  COMMENT_PENDING_APPROVAL: 'caution',
  CONNECTION_PENDING_APPROVAL: 'caution',
  STOPPED: 'neutral',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
  REJECTED: 'critical',
  FAILED: 'critical',
  CANDIDATE_REJECTED: 'critical',
  // Account lifecycle, shown on the admin user list.
  ACTIVE: 'positive',
  DEACTIVATED: 'critical',
  PENDING_VERIFICATION: 'caution',
  ADMIN: 'accent',
  USER: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  WOULD_LIKE: 'WOULD LIKE (dry run)',
  WOULD_COMMENT: 'WOULD COMMENT (dry run)',
  SKIPPED_DRY_RUN: 'SIMULATED (dry run)',
  PENDING_VERIFICATION: 'AWAITING VERIFICATION',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
    </Badge>
  )
}

export function ScorePill({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-ink-faint">—</span>
  }
  const tone: Tone = score >= 85 ? 'positive' : score >= 70 ? 'accent' : score >= 50 ? 'caution' : 'critical'
  return (
    <Badge tone={tone} className="tabular">
      {score}/100
    </Badge>
  )
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-ink-muted">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p className="max-w-md text-sm text-ink-muted leading-relaxed">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

export function TagList({
  values,
  emptyLabel = 'None',
}: {
  values: string[]
  emptyLabel?: string
}) {
  if (!values.length) {
    return <span className="text-xs text-ink-faint">{emptyLabel}</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value}>{value}</Badge>
      ))}
    </div>
  )
}
