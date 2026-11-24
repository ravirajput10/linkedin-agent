/**
 * Unified storage abstraction for Chrome Extension and Web Dev Preview environments.
 * Seamlessly manages auth tokens, paired session state, and user preferences across:
 * - chrome.storage.local (unpacked extension popup / background context)
 * - window.localStorage (web dev preview at http://localhost:5174 or tab fallback)
 */

export interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  accountTier: string;
  profileUrl: string;
  connectedAt: string;
  authState: 'DISCONNECTED' | 'CONNECTED';
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  MEMBER_ID: 'paired_member_id',
  MEMBER_NAME: 'paired_member_name',
  MEMBER_EMAIL: 'paired_member_email',
  ACCOUNT_TIER: 'account_tier',
  PROFILE_URL: 'paired_profile_url',
  CONNECTED_AT: 'paired_connected_at',
  AUTH_STATE: 'agent_auth_state',
  API_BASE: 'agent_api_base',
  WEB_APP_URL: 'agent_web_app_url',
};

const LEGACY_STORAGE_KEYS = [
  'access_token',
  'refresh_token',
  'paired_member_id',
  'paired_member_name',
  'account_tier',
];

export async function getStoredToken(): Promise<string> {
  // 1. Try chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = (await chrome.storage.local.get([
        STORAGE_KEYS.ACCESS_TOKEN,
        'access_token',
      ])) as Record<string, unknown>;
      if (typeof stored[STORAGE_KEYS.ACCESS_TOKEN] === 'string' && stored[STORAGE_KEYS.ACCESS_TOKEN]) {
        return stored[STORAGE_KEYS.ACCESS_TOKEN] as string;
      }
      if (typeof stored['access_token'] === 'string' && stored['access_token']) {
        return stored['access_token'] as string;
      }
    } catch {
      // Ignore chrome storage errors
    }
  }

  // 2. Fall back to localStorage
  try {
    const token =
      localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('linkedin-agent.access-token') ||
      '';
    return token;
  } catch {
    return '';
  }
}

export async function getStoredRefreshToken(): Promise<string> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = (await chrome.storage.local.get([
        STORAGE_KEYS.REFRESH_TOKEN,
        'refresh_token',
      ])) as Record<string, unknown>;
      if (typeof stored[STORAGE_KEYS.REFRESH_TOKEN] === 'string' && stored[STORAGE_KEYS.REFRESH_TOKEN]) {
        return stored[STORAGE_KEYS.REFRESH_TOKEN] as string;
      }
      if (typeof stored['refresh_token'] === 'string' && stored['refresh_token']) {
        return stored['refresh_token'] as string;
      }
    } catch {
      // Ignore
    }
  }

  try {
    return (
      localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) ||
      localStorage.getItem('refresh_token') ||
      localStorage.getItem('linkedin-agent.refresh-token') ||
      ''
    );
  } catch {
    return '';
  }
}

export async function saveAuthTokens(accessToken: string, refreshToken?: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const updates: Record<string, unknown> = {
        [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
        access_token: accessToken,
      };
      if (refreshToken) {
        updates[STORAGE_KEYS.REFRESH_TOKEN] = refreshToken;
        updates.refresh_token = refreshToken;
      }
      await chrome.storage.local.set(updates);
    } catch {
      // Ignore
    }
  }

  try {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem('access_token', accessToken);
    if (refreshToken) {
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      localStorage.setItem('refresh_token', refreshToken);
    }
  } catch {
    // Ignore
  }
}

export async function refreshStoredToken(apiBase: string): Promise<string | null> {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.access_token) {
      await saveAuthTokens(data.access_token, data.refresh_token || refreshToken);
      return data.access_token as string;
    }
  } catch {
    // Network errors ignored
  }
  return null;
}

export async function getStoredSession(): Promise<StoredSession> {
  let token = '';
  let memberId = '';
  let memberName = 'LinkedIn Member';
  let memberEmail = 'user@linkedin.com';
  let accountTier = 'FREE';
  let profileUrl = 'https://www.linkedin.com';
  let connectedAt = new Date().toISOString();
  let authState: 'DISCONNECTED' | 'CONNECTED' = 'DISCONNECTED';

  // 1. Try reading from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const keys = [
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.MEMBER_ID,
        STORAGE_KEYS.MEMBER_NAME,
        STORAGE_KEYS.MEMBER_EMAIL,
        STORAGE_KEYS.ACCOUNT_TIER,
        STORAGE_KEYS.PROFILE_URL,
        STORAGE_KEYS.CONNECTED_AT,
        STORAGE_KEYS.AUTH_STATE,
        ...LEGACY_STORAGE_KEYS,
      ];
      const res = (await chrome.storage.local.get(keys)) as Record<string, unknown>;
      if (res[STORAGE_KEYS.ACCESS_TOKEN]) token = String(res[STORAGE_KEYS.ACCESS_TOKEN]);
      else if (res['access_token']) token = String(res['access_token']);

      if (res[STORAGE_KEYS.MEMBER_ID]) memberId = String(res[STORAGE_KEYS.MEMBER_ID]);
      else if (res['paired_member_id']) memberId = String(res['paired_member_id']);

      if (res[STORAGE_KEYS.MEMBER_NAME]) memberName = String(res[STORAGE_KEYS.MEMBER_NAME]);
      else if (res['paired_member_name']) memberName = String(res['paired_member_name']);

      if (res[STORAGE_KEYS.MEMBER_EMAIL]) memberEmail = String(res[STORAGE_KEYS.MEMBER_EMAIL]);
      if (res[STORAGE_KEYS.ACCOUNT_TIER]) accountTier = String(res[STORAGE_KEYS.ACCOUNT_TIER]);
      else if (res['account_tier']) accountTier = String(res['account_tier']);

      if (res[STORAGE_KEYS.PROFILE_URL]) profileUrl = String(res[STORAGE_KEYS.PROFILE_URL]);
      if (res[STORAGE_KEYS.CONNECTED_AT]) connectedAt = String(res[STORAGE_KEYS.CONNECTED_AT]);
      if (res[STORAGE_KEYS.AUTH_STATE] === 'CONNECTED') authState = 'CONNECTED';
    } catch {
      // Ignore
    }
  }

  // 2. Check localStorage (fills any blanks or serves web preview)
  try {
    if (!token) {
      token =
        localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('linkedin-agent.access-token') ||
        '';
    }
    if (!memberId) {
      memberId = localStorage.getItem(STORAGE_KEYS.MEMBER_ID) || localStorage.getItem('paired_member_id') || '';
    }
    if (memberName === 'LinkedIn Member') {
      const storedName = localStorage.getItem(STORAGE_KEYS.MEMBER_NAME) || localStorage.getItem('paired_member_name');
      if (storedName) memberName = storedName;
    }
    const storedEmail = localStorage.getItem(STORAGE_KEYS.MEMBER_EMAIL);
    if (storedEmail) memberEmail = storedEmail;

    const storedTier = localStorage.getItem(STORAGE_KEYS.ACCOUNT_TIER) || localStorage.getItem('account_tier');
    if (storedTier) accountTier = storedTier;

    const storedUrl = localStorage.getItem(STORAGE_KEYS.PROFILE_URL);
    if (storedUrl) profileUrl = storedUrl;

    const storedConnectedAt = localStorage.getItem(STORAGE_KEYS.CONNECTED_AT);
    if (storedConnectedAt) connectedAt = storedConnectedAt;

    const storedState = localStorage.getItem(STORAGE_KEYS.AUTH_STATE);
    if (storedState === 'CONNECTED' || (token && !storedState)) {
      authState = 'CONNECTED';
    }
  } catch {
    // Ignore
  }

  return {
    accessToken: token,
    memberId,
    memberName,
    memberEmail,
    accountTier,
    profileUrl,
    connectedAt,
    authState: token ? 'CONNECTED' : authState,
  };
}

export async function saveSession(params: {
  accessToken: string;
  refreshToken?: string;
  memberId: string;
  memberName?: string;
  memberEmail?: string;
  accountTier?: string;
  profileUrl?: string;
}): Promise<void> {
  const { accessToken, refreshToken, memberId, memberName, memberEmail, accountTier, profileUrl } = params;
  const now = new Date().toISOString();

  // 1. Write to chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const updates: Record<string, unknown> = {
        [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
        [STORAGE_KEYS.MEMBER_ID]: memberId,
        [STORAGE_KEYS.MEMBER_NAME]: memberName || 'LinkedIn Member',
        [STORAGE_KEYS.MEMBER_EMAIL]: memberEmail || 'user@linkedin.com',
        [STORAGE_KEYS.ACCOUNT_TIER]: accountTier || 'FREE',
        [STORAGE_KEYS.PROFILE_URL]: profileUrl || 'https://www.linkedin.com',
        [STORAGE_KEYS.CONNECTED_AT]: now,
        [STORAGE_KEYS.AUTH_STATE]: 'CONNECTED',
        // Legacy keys for background service_worker.js compatibility
        access_token: accessToken,
        paired_member_id: memberId,
        account_tier: accountTier || 'FREE',
      };
      if (refreshToken) {
        updates[STORAGE_KEYS.REFRESH_TOKEN] = refreshToken;
        updates.refresh_token = refreshToken;
      }
      await chrome.storage.local.set(updates);
    } catch {
      // Ignore
    }
  }

  // 2. Write to localStorage
  try {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(STORAGE_KEYS.MEMBER_ID, memberId);
    if (refreshToken) {
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      localStorage.setItem('refresh_token', refreshToken);
    }
    if (memberName) localStorage.setItem(STORAGE_KEYS.MEMBER_NAME, memberName);
    if (memberEmail) localStorage.setItem(STORAGE_KEYS.MEMBER_EMAIL, memberEmail);
    if (accountTier) localStorage.setItem(STORAGE_KEYS.ACCOUNT_TIER, accountTier);
    if (profileUrl) localStorage.setItem(STORAGE_KEYS.PROFILE_URL, profileUrl);
    localStorage.setItem(STORAGE_KEYS.CONNECTED_AT, now);
    localStorage.setItem(STORAGE_KEYS.AUTH_STATE, 'CONNECTED');

    // Also set legacy keys for cross-module compatibility
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('paired_member_id', memberId);
  } catch {
    // Ignore
  }
}

export async function clearLinkedInSession(): Promise<void> {
  // Clears LinkedIn platform connection data while preserving workspace access token
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.remove([
        STORAGE_KEYS.MEMBER_ID,
        STORAGE_KEYS.MEMBER_NAME,
        STORAGE_KEYS.MEMBER_EMAIL,
        STORAGE_KEYS.ACCOUNT_TIER,
        STORAGE_KEYS.PROFILE_URL,
        STORAGE_KEYS.CONNECTED_AT,
        STORAGE_KEYS.AUTH_STATE,
        'paired_member_id',
        'paired_member_name',
        'account_tier',
      ]);
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_STATE]: 'DISCONNECTED' });
    } catch {
      // Ignore
    }
  }

  try {
    localStorage.removeItem(STORAGE_KEYS.MEMBER_ID);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_NAME);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_EMAIL);
    localStorage.removeItem(STORAGE_KEYS.ACCOUNT_TIER);
    localStorage.removeItem(STORAGE_KEYS.PROFILE_URL);
    localStorage.removeItem(STORAGE_KEYS.CONNECTED_AT);
    localStorage.setItem(STORAGE_KEYS.AUTH_STATE, 'DISCONNECTED');
    localStorage.removeItem('paired_member_id');
  } catch {
    // Ignore
  }
}

export async function clearSession(): Promise<void> {
  // 1. Clear chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.remove([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.MEMBER_ID,
        STORAGE_KEYS.MEMBER_NAME,
        STORAGE_KEYS.MEMBER_EMAIL,
        STORAGE_KEYS.ACCOUNT_TIER,
        STORAGE_KEYS.PROFILE_URL,
        STORAGE_KEYS.CONNECTED_AT,
        STORAGE_KEYS.AUTH_STATE,
        ...LEGACY_STORAGE_KEYS,
      ]);
    } catch {
      // Ignore
    }
  }

  // 2. Clear localStorage
  try {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_ID);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_NAME);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_EMAIL);
    localStorage.removeItem(STORAGE_KEYS.ACCOUNT_TIER);
    localStorage.removeItem(STORAGE_KEYS.PROFILE_URL);
    localStorage.removeItem(STORAGE_KEYS.CONNECTED_AT);
    localStorage.removeItem(STORAGE_KEYS.AUTH_STATE);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('paired_member_id');
  } catch {
    // Ignore
  }
}
