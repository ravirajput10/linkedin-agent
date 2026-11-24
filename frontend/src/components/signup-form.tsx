import { TurnstileWidget } from "@/components/TurnstileWidget"
import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { Eye, EyeOff, Lock, Mail, User, Sparkles, ShieldCheck, Clock } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/services/client"

function FormError({ error }: { error: unknown }) {
  if (!error) return null

  const message =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong. Try again."

  const details = error instanceof ApiRequestError ? error.details : undefined
  const fieldErrors = Array.isArray(details?.errors)
    ? (details.errors as { loc?: unknown[]; msg?: string }[])
    : []

  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
    >
      <p className="font-medium">{message}</p>
      {fieldErrors.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs space-y-0.5">
          {fieldErrors.map((item, index) => (
            <li key={index}>{item.msg ?? "Invalid value"}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface SignupFormProps extends React.ComponentProps<"div"> {
  fullName: string
  setFullName: (val: string) => void
  email: string
  setEmail: (val: string) => void
  password: string
  setPassword: (val: string) => void
  confirm: string
  setConfirm: (val: string) => void
  onSubmit: (e: FormEvent) => void
  submitting: boolean
  error: unknown
  minLength: number
  mismatch: boolean
  tooShort: boolean
  submitLabel?: string
  siteKey?: string
  turnstileToken: string
  onTurnstileSuccess: (token: string) => void
}

export function SignupForm({
  className,
  fullName,
  setFullName,
  email,
  setEmail,
  password,
  setPassword,
  confirm,
  setConfirm,
  onSubmit,
  submitting,
  error,
  minLength,
  siteKey,
  turnstileToken,
  onTurnstileSuccess,
  mismatch,
  tooShort,
  submitLabel = "Create new account",
  ...props
}: SignupFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      <Card className="overflow-hidden p-0 shadow-xl border-border/80">
        <CardContent className="grid p-0 md:grid-cols-2">
          {/* Left Column: Form */}
          <form onSubmit={onSubmit} className="p-6 md:p-8 flex flex-col justify-between" noValidate>
            <FieldGroup className="gap-3.5">
              <div className="flex flex-col items-center gap-1.5 text-center mb-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  AI Engagement Agent
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Create your account</h1>
                <p className="text-sm text-muted-foreground text-balance max-w-xs">
                  You get your own campaigns, candidates and settings.
                </p>
              </div>

              <FormError error={error} />

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="fullName">Full name</FieldLabel>
                  <span className="text-[11px] text-muted-foreground">Optional</span>
                </div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="fullName"
                    name="name"
                    type="text"
                    placeholder="Jane Doe"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={submitting}
                    className="pl-9"
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="pl-9"
                  />
                </div>
              </Field>

              <Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="password"
                        name="new-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={submitting}
                        aria-invalid={tooShort}
                        className="pl-9 pr-8"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">Confirm</FieldLabel>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="confirm-password"
                        name="confirm-password"
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        disabled={submitting}
                        aria-invalid={mismatch}
                        className="pl-9 pr-8"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                        onClick={() => setShowConfirm(!showConfirm)}
                        aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                      >
                        {showConfirm ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </Field>
                </div>
                <FieldDescription className="text-xs">
                  At least {minLength} characters.
                </FieldDescription>
                {mismatch && (
                  <p className="text-xs text-destructive font-medium mt-1">
                    The two passwords do not match.
                  </p>
                )}
                {tooShort && (
                  <p className="text-xs text-destructive font-medium mt-1">
                    Use at least {minLength} characters.
                  </p>
                )}
              </Field>

              <Field className="pt-0">
                <TurnstileWidget
                  siteKey={siteKey}
                  onSuccess={onTurnstileSuccess}
                  onError={() => onTurnstileSuccess("")}
                  onExpire={() => onTurnstileSuccess("")}
                />
              </Field>

              <Field className="pt-1">
                <Button
                  type="submit"
                  className="w-full h-10 font-semibold shadow-md active:scale-[0.99] transition-all"
                  disabled={submitting || !email || !password || !confirm || mismatch || tooShort || (Boolean(siteKey) && !turnstileToken)}
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Creating account...
                    </span>
                  ) : (
                    submitLabel
                  )}
                </Button>
              </Field>

              <FieldDescription className="text-center pt-1 text-xs">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>
              </FieldDescription>
            </FieldGroup>
          </form>

          {/* Right Column: Hero Graphic Banner */}
          <div className="relative hidden md:flex flex-col justify-between p-8 bg-gradient-to-br from-primary/15 via-primary/5 to-background border-l border-border/80">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-base shadow-md ring-2 ring-primary/20">
                in
              </div>
              <div>
                <span className="font-bold text-sm tracking-tight text-foreground block">LinkedIn Agent</span>
                <span className="text-[11px] text-muted-foreground block -mt-0.5">Autonomous Outreach</span>
              </div>
            </div>

            <div className="space-y-3.5 my-auto py-6">
              <div className="p-3.5 rounded-xl bg-card/70 backdrop-blur-sm border border-border/70 shadow-sm transition-all hover:bg-card/90">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary mb-1">
                  <Sparkles className="size-3.5 text-primary" />
                  Deterministic Automation
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The LLM supplies reasoning only. The workflow engine pauses for your approval before actions are published.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-card/70 backdrop-blur-sm border border-border/70 shadow-sm transition-all hover:bg-card/90">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
                  <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Account Safety First
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Row-locked rate limiting, dry-run simulation mode, and complete audit trails for every action.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-card/70 backdrop-blur-sm border border-border/70 shadow-sm transition-all hover:bg-card/90">
                <div className="flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400 mb-1">
                  <Clock className="size-3.5 text-sky-600 dark:text-sky-400" />
                  Smart Human Pacing
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Natural multi-day delays between likes, comments, and connection notes to look authentic.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/50">
              <span>Warm outreach</span>
              <span>•</span>
              <span>Human-in-the-loop</span>
              <span>•</span>
              <span>AI Networking</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <FieldDescription className="px-6 text-center text-xs text-muted-foreground">
        By clicking continue, you agree to our{" "}
        <a href="#" className="underline hover:text-foreground" onClick={(e) => e.preventDefault()}>
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="#" className="underline hover:text-foreground" onClick={(e) => e.preventDefault()}>
          Privacy Policy
        </a>.
      </FieldDescription>
    </div>
  )
}
