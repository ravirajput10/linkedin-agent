// Content script to sync authentication and verify state between Web App and Chrome Extension
(function () {
  function getStoredToken() {
    try {
      const direct =
        localStorage.getItem('linkedin-agent.access-token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('access_token');
      const refreshToken =
        localStorage.getItem('linkedin-agent.refresh-token') ||
        localStorage.getItem('refresh_token');

      let user = null;
      const rawUser = localStorage.getItem('auth_user') || localStorage.getItem('user');
      if (rawUser) {
        try { user = JSON.parse(rawUser); } catch {}
      }

      if (direct) return { token: direct, refreshToken, user };

      const raw = localStorage.getItem('auth_tokens');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.access_token) {
          return {
            token: parsed.access_token,
            refreshToken: parsed.refresh_token || refreshToken,
            user: parsed.user || user,
          };
        }
      }
    } catch {
      // ignore
    }
    return { token: null, refreshToken: null, user: null };
  }

  function syncSessionWithExtension(explicitToken, explicitUser, explicitRefreshToken) {
    const { token: storedToken, refreshToken: storedRefreshToken, user: storedUser } = getStoredToken();
    const token = explicitToken || storedToken;
    const refreshToken = explicitRefreshToken || storedRefreshToken;
    const user = explicitUser || storedUser;

    if (!token) return;

    // Web app UI location: root on localhost (http://localhost:5173) or subpath on staging (/linkedin-agent)
    const hasSubpath = window.location.pathname.startsWith('/linkedin-agent');
    const webAppUrl = hasSubpath ? `${window.location.origin}/linkedin-agent` : window.location.origin;

    // Backend API is standardized to /linkedin-agent/api across both local and staging
    const apiBase = `${window.location.origin}/linkedin-agent/api`;

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'SYNC_AUTH_TOKEN',
          token,
          refreshToken,
          user,
          webAppUrl,
          apiBase,
        },
        (res) => {
          if (chrome.runtime.lastError) {
            // Service worker may be waking up
            return;
          }
          if (res?.ok) {
            window.postMessage({ type: 'EXTENSION_ONLINE', status: 'CONNECTED' }, window.location.origin);
          }
        }
      );
    }
  }

  // Sync on initial document load
  syncSessionWithExtension();

  // Listen for verify requests dispatched by the web app
  window.addEventListener('message', (event) => {
    // Only the page itself, never an iframe or another window it opened.
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (
      event.data?.type === 'AGENT_VERIFY_REQUEST' ||
      event.data?.type === 'AGENT_PING_EXTENSION'
    ) {
      syncSessionWithExtension(event.data?.token, event.data?.user);
    }
  });

  // Listen for direct queries from extension popup or service worker
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'AGENT_GET_AUTH_TOKEN') {
        const session = getStoredToken();
        sendResponse(session);
        return true;
      }
    });
  }

  // Listen for storage changes across tabs and window focus
  window.addEventListener('storage', () => syncSessionWithExtension());
  window.addEventListener('focus', () => syncSessionWithExtension());
  setInterval(syncSessionWithExtension, 4000);
})();

