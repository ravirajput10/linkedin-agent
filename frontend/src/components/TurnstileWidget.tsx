import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface TurnstileWidgetProps {
  siteKey?: string
  onSuccess: (token: string) => void
  onError?: (error?: string) => void
  onExpire?: () => void
  theme?: 'light' | 'dark' | 'auto'
  className?: string
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: (err: any) => void
          'expired-callback'?: () => void
          theme?: string
        }
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
    onloadTurnstileCallback?: () => void
  }
}

export function TurnstileWidget({
  siteKey,
  onSuccess,
  onError,
  onExpire,
  theme = 'auto',
  className = '',
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  // Keep callback refs stable to prevent infinite re-render loops
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  // Loaded strictly from props (via /auth/security-config backed by .env) or VITE_ .env variable
  const effectiveSiteKey =
    typeof siteKey === 'string' && siteKey.trim().length > 0
      ? siteKey.trim()
      : (import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || ''

  useEffect(() => {
    // If turnstile script already loaded
    if (window.turnstile) {
      setIsLoaded(true)
      return
    }

    // Check if script tag already injected
    const existingScript = document.getElementById('cf-turnstile-script')
    if (!existingScript) {
      const script = document.createElement('script')
      script.id = 'cf-turnstile-script'
      // Use render=explicit so Cloudflare does not implicitly scan DOM or expect cf-turnstile class
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback'
      script.async = true
      script.defer = true
      window.onloadTurnstileCallback = () => {
        setIsLoaded(true)
      }
      document.head.appendChild(script)
    } else {
      window.onloadTurnstileCallback = () => {
        setIsLoaded(true)
      }
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || !window.turnstile || !containerRef.current || !effectiveSiteKey) return

    // Clean up previous widget if exists
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current)
      } catch {
        // ignore
      }
      widgetIdRef.current = null
    }

    try {
      const id = window.turnstile.render(containerRef.current, {
        sitekey: effectiveSiteKey,
        callback: (token: string) => {
          onSuccessRef.current?.(token)
        },
        'error-callback': (err: any) => {
          const msg = typeof err === 'string' ? err : 'Turnstile challenge failed'
          onErrorRef.current?.(msg)
        },
        'expired-callback': () => {
          onExpireRef.current?.()
        },
        theme,
      })
      widgetIdRef.current = id
    } catch (err: any) {
      console.warn('[Turnstile] render error:', err)
      onErrorRef.current?.(err?.message || 'Failed to render Turnstile widget')
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
        widgetIdRef.current = null
      }
    }
  }, [isLoaded, effectiveSiteKey, theme])

  if (!effectiveSiteKey) {
    return (
      <div className={`flex items-center justify-center min-h-[65px] text-xs text-slate-400 ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2 text-slate-400" />
        <span>Loading security verification...</span>
      </div>
    )
  }

  return (
    <div className={`flex justify-center my-3 ${className}`}>
      <div ref={containerRef} className="turnstile-container min-h-[65px]" />
    </div>
  )
}
