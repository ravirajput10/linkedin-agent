import { TurnstileWidget } from "@/components/TurnstileWidget"
import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { Eye, EyeOff, Lock, Mail, Sparkles, ShieldCheck, Clock } from "lucide-react"
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

interface LoginFormProps extends React.ComponentProps<"div"> {
  email: string
  setEmail: (val: string) => void
  password: string
  setPassword: (val: string) => void
  onSubmit: (e: FormEvent) => void
  submitting: boolean
  error: unknown
  allowRegistration?: boolean
  siteKey?: string
  turnstileToken: string
  onTurnstileSuccess: (token: string) => void
}

export function LoginForm({
  siteKey,
  turnstileToken,
  onTurnstileSuccess,
  className,
  email,
  setEmail,
  password,
  setPassword,
  onSubmit,
  submitting,
  error,
  allowRegistration = true,
  ...props
}: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      <Card className="overflow-hidden p-0 shadow-xl border-border/80">
        <CardContent className="grid p-0 md:grid-cols-2">
          {/* Left Column: Form */}
          <form onSubmit={onSubmit} className="p-6 md:p-8 flex flex-col justify-between" noValidate>
            <FieldGroup className="gap-4">
              <div className="flex flex-col items-center gap-1.5 text-center mb-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  AI Engagement Agent
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Sign in</h1>
                <p className="text-sm text-muted-foreground text-balance max-w-xs">
                  Your campaigns, candidates and approvals are private to your account.
                </p>
              </div>

              <FormError error={error} />

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
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="pl-9"
                  />
                </div>
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a
                    href="#"
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    onClick={(e) => e.preventDefault()}
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    className="pl-9 pr-9"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
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
                  disabled={submitting || !email || !password || (Boolean(siteKey) && !turnstileToken)}
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Signing in...
                    </span>
                  ) : (
                    "Sign in"
                  )}
                </Button>
              </Field>

              <FieldDescription className="text-center pt-1 text-xs">
                {!allowRegistration ? (
                  <span className="text-muted-foreground">
                    Sign-up is closed. Ask an administrator for an account.
                  </span>
                ) : (
                  <>
                    New here?{" "}
                    <Link
                      to="/register"
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      Create an account
                    </Link>
                  </>
                )}
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
