import React, { useState } from 'react';

interface LoginFormProps {
  onLogin: (email: string, pass: string) => Promise<void>;
  onSignInWithLinkedIn?: () => void;
  onPairActiveSession?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  isAuthenticated?: boolean;
  authenticatedUser?: { name: string; email: string } | null;
  hasActiveSession?: boolean;
  isLoading: boolean;
  error?: string | null;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onLogin,
  onSignInWithLinkedIn,
  onPairActiveSession,
  onSignOut,
  isAuthenticated = false,
  authenticatedUser = null,
  hasActiveSession = false,
  isLoading,
  error,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    onLogin(email.trim(), password);
  };

  return (
    <div className="auth-card">
      <div className="brand-header">
        <div className="logo-badge">
          <svg className="linkedin-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
          </svg>
          <span className="ai-badge">AI Agent</span>
        </div>
        <h2>{isAuthenticated ? 'Connect LinkedIn' : 'Sign in to Workspace'}</h2>
        <p className="subtitle">
          {isAuthenticated
            ? 'Connect your browser LinkedIn session to enable autonomous outreach and profile warm-ups.'
            : 'Sign in to your workspace to start autonomous AI networking and profile growth.'}
        </p>
      </div>

      {error && (
        <div className="alert-error">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* ---------------- STATE 2: ALREADY AUTHENTICATED IN WORKSPACE ---------------- */}
      {isAuthenticated ? (
        <div style={{ width: '100%', marginBottom: '14px' }}>
          {/* User badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '10px',
            marginBottom: '12px',
            fontSize: '11px',
            color: '#1e40af',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '12px' }}>👤</span>
              <span style={{ fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {authenticatedUser?.name || 'Workspace User'}
              </span>
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px 6px',
                  color: '#64748b',
                  fontSize: '10px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Sign out
              </button>
            )}
          </div>

          {/* Connect Session Box */}
          <div style={{
            width: '100%',
            padding: '14px',
            background: hasActiveSession ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${hasActiveSession ? '#bbf7d0' : '#e2e8f0'}`,
            borderRadius: '12px',
            marginBottom: '12px',
            textAlign: 'left',
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '14px' }}>{hasActiveSession ? '🟢' : '⚡'}</span>
              <strong style={{ fontSize: '13px', color: hasActiveSession ? '#166534' : '#1e293b' }}>
                {hasActiveSession ? 'Active LinkedIn Session Detected' : 'Connect Browser LinkedIn Session'}
              </strong>
            </div>
            <p style={{ fontSize: '11px', color: hasActiveSession ? '#15803d' : '#64748b', margin: '0 0 12px 0', lineHeight: '1.4' }}>
              {hasActiveSession
                ? 'Chrome detected your active LinkedIn login. Connect now to pair your session with the agent.'
                : 'Pairs your logged-in Chrome LinkedIn tab with the AI Agent in 1 click.'}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onPairActiveSession}
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="spinner-text">
                  <span className="spinner"></span> Connecting Session...
                </span>
              ) : (
                'Connect Active LinkedIn Session'
              )}
            </button>

            <div style={{ marginTop: '10px', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Not logged into LinkedIn yet?{' '}
                <button
                  type="button"
                  onClick={() => {
                    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                      chrome.tabs.create({ url: 'https://www.linkedin.com/login' });
                    } else {
                      window.open('https://www.linkedin.com/login', '_blank');
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#0284c7',
                    textDecoration: 'underline',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Open LinkedIn in New Tab
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ---------------- STATE 1: UNAUTHENTICATED IN WORKSPACE ---------------- */
        <div style={{ width: '100%', marginBottom: '14px' }}>
          {/* Primary: Sign In with LinkedIn */}
          <button
            type="button"
            className="btn-primary"
            onClick={onSignInWithLinkedIn}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '11px 16px',
              background: '#0a66c2',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              marginBottom: '14px',
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
            </svg>
            <span>Sign In with LinkedIn</span>
          </button>

          {/* Secondary: Collapsible Developer / Local Form */}
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={() => setShowManualForm(!showManualForm)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '11px',
                color: '#64748b',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              {showManualForm ? 'Hide developer login' : 'Developer & Local Testing Login'}
            </button>
          </div>

          {showManualForm && (
            <form onSubmit={handleSubmit} className="form-group" style={{ width: '100%', marginBottom: '12px' }}>
              <div className="field">
                <label htmlFor="email">Account Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="password-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary" disabled={isLoading} style={{ marginTop: '8px' }}>
                {isLoading ? (
                  <span className="spinner-text">
                    <span className="spinner"></span> Authenticating...
                  </span>
                ) : (
                  'Sign In with Credentials'
                )}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="login-features-list">
        <div className="login-feature-item">
          <div className="login-feature-icon">🎯</div>
          <div className="login-feature-text">
            <strong>Instant Profile Match</strong>
            <span>AI scores prospect fit (0–100%) on any profile</span>
          </div>
        </div>
        <div className="login-feature-item">
          <div className="login-feature-icon">⚡</div>
          <div className="login-feature-text">
            <strong>Autonomous Engagement</strong>
            <span>Smart connection notes, post likes & auto-approvals</span>
          </div>
        </div>
        <div className="login-feature-item">
          <div className="login-feature-icon">🛡️</div>
          <div className="login-feature-text">
            <strong>Safe Daily Limits</strong>
            <span>Enforces strict rate limits to protect your LinkedIn account</span>
          </div>
        </div>
      </div>

      <div className="trust-footer">
        <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
        </svg>
        <span>End-to-end encrypted connection with agent backend</span>
      </div>
    </div>
  );
};
