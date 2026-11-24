import { useState, useEffect } from 'react';
import type { AuthState, CheckpointData, ConnectedProfile, DailyUsage } from './types';
import { LoginForm } from './components/LoginForm';
import { OtpCheckpoint } from './components/OtpCheckpoint';
import { DashboardHub } from './components/DashboardHub';
import {
  getStoredSession,
  getStoredToken,
  saveSession,
  saveAuthTokens,
  refreshStoredToken,
  clearSession,
  clearLinkedInSession,
} from './storage';
import './App.css';

const DEFAULT_API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ||
  (typeof window !== 'undefined' && window.location.hostname.includes('divergentsl.com')
    ? 'https://staging.divergentsl.com/linkedin-agent/api'
    : 'http://localhost:5173/linkedin-agent/api');

function sanitizeApiBase(rawUrl?: string): string {
  if (!rawUrl) return DEFAULT_API_BASE;
  try {
    const url = new URL(rawUrl);
    if (!url.hostname || url.hostname === 'api') {
      return DEFAULT_API_BASE;
    }
    return `${url.origin}/linkedin-agent/api`;
  } catch {
    return DEFAULT_API_BASE;
  }
}

async function getApiBase(): Promise<string> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get(['agent_api_base', 'api_base']);
      if (stored && (stored.agent_api_base || stored.api_base)) {
        return sanitizeApiBase((stored.agent_api_base || stored.api_base) as string);
      }
    } catch {
      // fallback
    }
  }
  try {
    const local = localStorage.getItem('agent_api_base') || localStorage.getItem('api_base');
    if (local) return sanitizeApiBase(local);
  } catch {
    // fallback
  }
  return DEFAULT_API_BASE;
}

function getWebAppUrl(): string {
  if (typeof window !== 'undefined' && window.location.hostname.includes('divergentsl.com')) {
    return 'https://staging.divergentsl.com/linkedin-agent';
  }
  return 'http://localhost:5173';
}

/**
 * Maps raw HTTP error codes to safe, friendly user-facing messages.
 * Detailed technical logs are sent to console.error for developer inspection.
 */
function sanitizeErrorMessage(status: number): string {
  if (status === 0 || !navigator.onLine) {
    return 'Cannot reach the agent service. Please ensure the backend is running.';
  }
  if (status === 401 || status === 403) {
    return 'Session expired or unauthorized. Please sign in again.';
  }
  if (status === 400 || status === 422) {
    return 'Could not verify LinkedIn profile. Please ensure you are logged into LinkedIn.';
  }
  if (status >= 500) {
    return 'Agent service is temporarily unavailable. Please try again shortly.';
  }
  return 'Failed to connect LinkedIn account. Please try again.';
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>('DISCONNECTED');
  const [isWorkspaceAuthenticated, setIsWorkspaceAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  const [checkpoint, setCheckpoint] = useState<CheckpointData | null>(null);

  const [profile, setProfile] = useState<ConnectedProfile>({
    name: 'LinkedIn Member',
    email: 'user@linkedin.com',
    unipileAccountId: '',
    accountTier: 'FREE',
    connectedAt: new Date().toISOString(),
  });

  const [usage, setUsage] = useState<DailyUsage>({
    likesUsed: 0,
    likesLimit: 30,
    commentsUsed: 0,
    commentsLimit: 10,
    connectionsUsed: 0,
    connectionsLimit: 15,
  });

  // Check agent status on mount & detect active LinkedIn session across refreshes
  useEffect(() => {
    let active = true;

    const checkStatus = async () => {
      try {
        const sessionData = await getStoredSession();
        if (!active) return;

        let token = sessionData.accessToken || (await getStoredToken());

        if (token) {
          setIsWorkspaceAuthenticated(true);
          setProfile((prev) => ({
            ...prev,
            name: sessionData.memberName || prev.name,
            email: sessionData.memberEmail || prev.email,
            accountTier: sessionData.accountTier || prev.accountTier,
            connectedAt: sessionData.connectedAt || prev.connectedAt,
          }));

          const apiBase = await getApiBase();
          let res = await fetch(`${apiBase}/agent/status`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });

          if (res.status === 401) {
            // Attempt silent token refresh
            const refreshed = await refreshStoredToken(apiBase);
            if (refreshed) {
              token = refreshed;
              res = await fetch(`${apiBase}/agent/status`, {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
              });
            } else {
              setIsWorkspaceAuthenticated(false);
              await clearSession();
              if (active) setAuthState('DISCONNECTED');
              return;
            }
          }

          if (!active) return;

          if (res.ok) {
            const data = await res.json();
            if (!active || !data) return;
            setIsWorkspaceAuthenticated(true);
            if (data.connected) {
              setAuthState('CONNECTED');
              setProfile((prev) => ({
                ...prev,
                name: data.member_name || sessionData.memberName || prev.name,
                accountTier: data.account_tier || sessionData.accountTier,
              }));
            } else {
              setAuthState('DISCONNECTED');
            }
          } else if (sessionData.authState === 'CONNECTED') {
            setAuthState('CONNECTED');
          }
        } else {
          setIsWorkspaceAuthenticated(false);
          setAuthState('DISCONNECTED');
        }
      } catch {
        // Backend not reachable or offline, keep local state
      }
    };

    checkStatus();

    // Check if user has active LinkedIn login via service worker
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CHECK_LINKEDIN_SESSION' }, (response: { isLoggedIn?: boolean; hasTab?: boolean } | undefined) => {
        if (!active) return;
        if (response && response.isLoggedIn) {
          setHasActiveSession(true);
        } else {
          setHasActiveSession(false);
        }
      });
    } else {
      setHasActiveSession(false);
    }

    // Reactive listener for storage sync (e.g. user logged in via web tab)
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName === 'local' && (changes.agent_access_token || changes.access_token)) {
          const newToken = changes.agent_access_token?.newValue || changes.access_token?.newValue;
          if (newToken && active) {
            setIsWorkspaceAuthenticated(true);
            checkStatus();
          }
        }
      };
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        active = false;
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }

    return () => {
      active = false;
    };
  }, []);

  // Primary: Sign In with LinkedIn via Web App
  const handleSignInWithLinkedIn = async () => {
    let webAppUrl = getWebAppUrl();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const stored = await chrome.storage.local.get(['agent_web_app_url', 'web_app_url']);
        if (stored?.agent_web_app_url || stored?.web_app_url) {
          webAppUrl = String(stored.agent_web_app_url || stored.web_app_url);
        }
      } catch {
        // fallback
      }
    }
    const loginUrl = `${webAppUrl.replace(/\/+$/, '')}/login`;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: loginUrl });
    } else {
      window.open(loginUrl, '_blank');
    }
  };

  // Sign out from workspace session
  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await clearSession();
      setIsWorkspaceAuthenticated(false);
      setAuthState('DISCONNECTED');
      setError(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click: Pair active browser session
  const handlePairActiveSession = async (providedToken?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      let memberName = 'LinkedIn Member';
      let profileUrl = 'https://www.linkedin.com';

      // 1. Query active LinkedIn tab to extract real profile info from content script
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
          if (tabs && tabs[0]?.id) {
            profileUrl = tabs[0].url || profileUrl;

            const tabProfile = await new Promise<{ name?: string; profileUrl?: string }>((resolve) => {
              chrome.tabs.sendMessage(tabs[0].id!, { type: 'GET_LINKEDIN_PROFILE' }, (resp) => {
                if (chrome.runtime.lastError || !resp) {
                  resolve({});
                } else {
                  resolve(resp);
                }
              });
            });

            if (tabProfile?.name) {
              memberName = tabProfile.name;
            }
            if (tabProfile?.profileUrl) {
              profileUrl = tabProfile.profileUrl;
            }

            // Fallback to title parsing if content script didn't extract name
            if ((!memberName || memberName === 'LinkedIn Member') && tabs[0].title) {
              const cleaned = tabs[0].title.replace(/^\(\d+\)\s*/, '').split('|')[0].trim();
              if (cleaned && cleaned.toLowerCase() !== 'feed' && cleaned.toLowerCase() !== 'linkedin') {
                memberName = cleaned;
              }
            }
          }
        } catch {
          // tab query error ignored
        }
      }

      // 2. Retrieve token or query active Web App tabs
      let token = providedToken || (await getStoredToken());
      if (!token && typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const webTabs = await chrome.tabs.query({
            url: [
              'http://localhost:5173/*',
              'http://127.0.0.1:5173/*',
              'http://localhost:3000/*',
              'https://staging.divergentsl.com/*',
            ],
          });
          if (webTabs && webTabs[0]?.id) {
            const webSession = await new Promise<{ token?: string; refreshToken?: string }>((resolve) => {
              chrome.tabs.sendMessage(webTabs[0].id!, { type: 'AGENT_GET_AUTH_TOKEN' }, (resp) => {
                resolve(resp || {});
              });
            });
            if (webSession?.token) {
              token = webSession.token;
              await saveAuthTokens(webSession.token, webSession.refreshToken);
              setIsWorkspaceAuthenticated(true);
            }
          }
        } catch {
          // web tabs query error ignored
        }
      }

      const apiBase = await getApiBase();

      if (!token) {
        setIsWorkspaceAuthenticated(false);
        throw new Error('Please sign in to your workspace first before connecting LinkedIn.');
      }

      const memberId = `urn:li:member:${Date.now()}`;
      const payload = {
        member_id: memberId,
        member_name: memberName,
        full_name: memberName,
        account_tier: 'FREE',
        profile_url: profileUrl,
      };

      // Pair session with backend
      let pairRes = await fetch(`${apiBase}/agent/pair-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      // If token expired (401), attempt silent token refresh and retry once
      if (pairRes.status === 401) {
        const refreshedToken = await refreshStoredToken(apiBase);
        if (refreshedToken) {
          token = refreshedToken;
          pairRes = await fetch(`${apiBase}/agent/pair-session`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
        } else {
          setIsWorkspaceAuthenticated(false);
          await clearSession();
          throw new Error('Session expired. Please sign in again.');
        }
      }

      if (!pairRes.ok) {
        const errJson = await pairRes.json().catch(() => null);
        console.error('[Agent Extension] pair-session failed:', {
          status: pairRes.status,
          response: errJson,
        });
        throw new Error(errJson?.detail || sanitizeErrorMessage(pairRes.status));
      }

      const pairData = await pairRes.json();
      const displayName = pairData.member_name || memberName;
      const derivedEmail = pairData.email || `${memberName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@linkedin.com`;
      const finalToken = pairData.access_token || token;

      // Persist session to both chrome.storage and localStorage
      await saveSession({
        accessToken: finalToken,
        memberId,
        memberName: displayName,
        memberEmail: derivedEmail,
        accountTier: pairData.account_tier || 'FREE',
        profileUrl,
      });

      // Dispatch initial heartbeat
      await fetch(`${apiBase}/agent/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${finalToken}`,
        },
        body: JSON.stringify({
          extension_version: '1.0.0',
          version: '1.0.0',
          linkedin_member_id: memberId,
          member_id: memberId,
          active_tab_session: 'ACTIVE',
        }),
      });

      // Update limits from server response
      if (pairData.daily_limits) {
        setUsage({
          likesUsed: 0,
          likesLimit: pairData.daily_limits.max_likes_per_day || 30,
          commentsUsed: 0,
          commentsLimit: pairData.daily_limits.max_comments_per_day || 10,
          connectionsUsed: 0,
          connectionsLimit: pairData.daily_limits.max_connections_per_day || 15,
        });
      }

      setProfile({
        name: displayName,
        email: derivedEmail,
        unipileAccountId: `agent_${Date.now()}`,
        accountTier: pairData.account_tier || 'FREE',
        connectedAt: new Date().toISOString(),
      });
      setIsWorkspaceAuthenticated(true);
      setAuthState('CONNECTED');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pair active LinkedIn session');
    } finally {
      setIsLoading(false);
    }
  };

  // Login handler (Developer / fallback)
  const handleLogin = async (email: string, pass: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const apiBase = await getApiBase();

      // 1. Authenticate user credentials with /api/auth/login
      const authRes = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: pass }),
      });

      if (!authRes.ok) {
        const errJson = await authRes.json().catch(() => null);
        throw new Error(errJson?.detail || 'Invalid email or password');
      }

      const authData = await authRes.json();
      const accessToken = authData.access_token;
      const refreshToken = authData.refresh_token;
      const user = authData.user || {};
      const memberName = user.full_name || email.split('@')[0].toUpperCase();

      await saveAuthTokens(accessToken, refreshToken);
      setIsWorkspaceAuthenticated(true);

      setProfile((prev) => ({
        ...prev,
        name: memberName,
        email: user.email || email,
        accountTier: user.account_tier || 'FREE',
      }));

      // If active session detected, attempt pairing immediately
      if (hasActiveSession) {
        await handlePairActiveSession(accessToken);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  // Submit OTP challenge
  const handleOtp = async (code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      if (!code || code.length < 4) {
        throw new Error('Please enter a valid verification PIN.');
      }
      const apiBase = await getApiBase();
      const token = await getStoredToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Pair session with backend after OTP
      const otpPairRes = await fetch(`${apiBase}/agent/pair-session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          member_id: 'urn:li:member:verified_session',
          member_name: 'VERIFIED MEMBER',
          full_name: 'VERIFIED MEMBER',
          account_tier: 'FREE',
        }),
      });
      if (!otpPairRes.ok) {
        const errJson = await otpPairRes.json().catch(() => null);
        console.error('[Agent Extension] OTP pair-session failed:', {
          status: otpPairRes.status,
          response: errJson,
        });
        throw new Error(sanitizeErrorMessage(otpPairRes.status));
      }
      const otpPairData = await otpPairRes.json();
      if (otpPairData.access_token) {
        await saveSession({
          accessToken: otpPairData.access_token,
          memberId: 'urn:li:member:verified_session',
          memberName: 'VERIFIED MEMBER',
          accountTier: 'FREE',
        });
        headers['Authorization'] = `Bearer ${otpPairData.access_token}`;
      }

      await fetch(`${apiBase}/agent/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          extension_version: '1.0.0',
          version: '1.0.0',
          linkedin_member_id: 'urn:li:member:verified_session',
          member_id: 'urn:li:member:verified_session',
          active_tab_session: 'ACTIVE',
        }),
      });
      setAuthState('CONNECTED');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click Disconnect LinkedIn
  const handleDisconnect = async () => {
    try {
      const apiBase = await getApiBase();
      const token = await getStoredToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      await fetch(`${apiBase}/agent/disconnect`, {
        method: 'POST',
        headers,
      });
    } catch {
      // Ignore disconnect errors
    }
    await clearLinkedInSession();
    setAuthState('DISCONNECTED');
    setCheckpoint(null);
    setError(null);
  };

  return (
    <div className={`extension-root ${authState === 'CONNECTED' ? 'is-authenticated' : ''}`}>
      {authState === 'DISCONNECTED' && (
        <LoginForm
          onLogin={handleLogin}
          onSignInWithLinkedIn={handleSignInWithLinkedIn}
          onPairActiveSession={() => handlePairActiveSession()}
          onSignOut={handleSignOut}
          isAuthenticated={isWorkspaceAuthenticated}
          authenticatedUser={profile}
          hasActiveSession={hasActiveSession}
          isLoading={isLoading}
          error={error}
        />
      )}

      {authState === 'CHECKPOINT_REQUIRED' && checkpoint && (
        <OtpCheckpoint
          checkpoint={checkpoint}
          onSubmitOtp={handleOtp}
          onCancel={() => setAuthState('DISCONNECTED')}
          isLoading={isLoading}
          error={error}
        />
      )}

      {authState === 'CONNECTED' && (
        <DashboardHub
          profile={profile}
          usage={usage}
          onDisconnect={handleDisconnect}
        />
      )}
    </div>
  );
}

export default App;
