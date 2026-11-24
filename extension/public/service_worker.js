// LinkedIn Agent — Background Service Worker
// Enforces (heartbeat every 30s), (session pairing), (session expiry & 1-click disconnect)

const API_BASE = 'http://localhost:5173/linkedin-agent/api';
const HEARTBEAT_ALARM = 'agent_heartbeat_alarm';
const EXTENSION_VERSION = '1.0.0';

// Web app origins allowed to hand this extension a session token and an API
// base. The build replaces this line with the dev origins plus VITE_APP_ORIGIN
// (see vite.config.ts). Anything else would let an arbitrary website point the
// extension at its own server.
const TRUSTED_APP_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:8000", "https://staging.divergentsl.com"];

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isTrustedOrigin(url) {
  return TRUSTED_APP_ORIGINS.includes(originOf(url));
}

function sanitizeApiBase(rawUrl) {
  if (!rawUrl) return API_BASE;
  try {
    const url = new URL(rawUrl);
    if (!url.hostname || url.hostname === 'api') {
      return API_BASE;
    }
    return `${url.origin}/linkedin-agent/api`;
  } catch {
    return API_BASE;
  }
}

// Drop or sanitize API base stored by an earlier version
chrome.storage.local.get(['agent_api_base', 'api_base']).then((stored) => {
  const rawBase = stored.agent_api_base || stored.api_base;
  if (rawBase) {
    const clean = sanitizeApiBase(rawBase);
    if (!isTrustedOrigin(clean)) {
      void chrome.storage.local.remove(['agent_api_base', 'api_base', 'agent_web_app_url', 'web_app_url', 'access_token']);
    } else {
      void chrome.storage.local.set({ agent_api_base: clean });
    }
  }
});

// Register 30s heartbeat alarm upon installation or service worker launch
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Agent Extension] Extension initialized. Scheduling heartbeat alarm...');
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  void sendHeartbeat();
});

// Alarm trigger
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void sendHeartbeat();
    void processActionQueue();
    void checkApprovalNotifications();
  }
});

// Detect whether user has an active tab on LinkedIn
async function detectLinkedInTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    if (tabs && tabs.length > 0) {
      return {
        hasTab: true,
        tabId: tabs[0].id,
        url: tabs[0].url,
        title: tabs[0].title,
      };
    }
  } catch (err) {
    console.debug('[Agent Extension] Tab query ignored:', err);
  }
  return { hasTab: false };
}

// Retrieve LinkedIn authentication cookie (li_at) from browser session
async function getLinkedInCookie() {
  try {
    if (chrome.cookies) {
      const cookie = await chrome.cookies.get({
        url: 'https://www.linkedin.com',
        name: 'li_at',
      });
      return cookie ? cookie.value : null;
    }
  } catch (err) {
    console.debug('[Agent Extension] Cookie access error:', err);
  }
  return null;
}

// Detect full LinkedIn session state
async function detectLinkedInSession() {
  const cookie = await getLinkedInCookie();
  const tabInfo = await detectLinkedInTab();
  return {
    isLoggedIn: Boolean(cookie),
    hasTab: tabInfo.hasTab,
    tabUrl: tabInfo.url || null,
    tabTitle: tabInfo.title || null,
  };
}

// Dispatches heartbeat to the backend (FR-1.4)
async function getApiBase() {
  try {
    const stored = await chrome.storage.local.get(['agent_api_base', 'api_base']);
    const rawBase = stored.agent_api_base || stored.api_base;
    if (rawBase) {
      const clean = sanitizeApiBase(rawBase);
      if (isTrustedOrigin(clean)) {
        return clean;
      }
    }
  } catch (err) {
    // fallback
  }
  return API_BASE;
}

async function sendHeartbeat() {
  try {
    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['paired_member_id', 'access_token']);
    const tabInfo = await detectLinkedInTab();

    const headers = {
      'Content-Type': 'application/json',
    };
    if (stored.access_token) {
      headers['Authorization'] = `Bearer ${stored.access_token}`;
    }

    const res = await fetch(`${apiBase}/agent/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: EXTENSION_VERSION,
        member_id: stored.paired_member_id || (tabInfo.hasTab ? 'urn:li:tab:active' : null),
        active_tab_session: tabInfo.hasTab ? 'ACTIVE' : null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log('[Agent Extension] Heartbeat confirmed by server:', data);
      return data;
    }

    if (res.status === 401) {
      const newToken = await silentRefreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${apiBase}/agent/heartbeat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            version: EXTENSION_VERSION,
            member_id: stored.paired_member_id || (tabInfo.hasTab ? 'urn:li:tab:active' : null),
            active_tab_session: tabInfo.hasTab ? 'ACTIVE' : null,
          }),
        });
        if (retryRes.ok) {
          return await retryRes.json();
        }
      }
    }
  } catch (err) {
    console.debug('[Agent Extension] Heartbeat dispatch failed:', err);
  }
  return null;
}

// Pair LinkedIn session with backend user account (FR-1.5, FR-1.6)
async function pairSession(payload) {
  const apiBase = await getApiBase();
  const stored = await chrome.storage.local.get(['access_token']);
  const headers = { 'Content-Type': 'application/json' };
  if (stored.access_token) {
    headers['Authorization'] = `Bearer ${stored.access_token}`;
  }

  const res = await fetch(`${apiBase}/agent/pair-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (res.ok) {
    await chrome.storage.local.set({
      paired_member_id: payload.member_id,
      account_tier: payload.account_tier || 'FREE',
    });
    // Immediately send heartbeat after successful pairing
    await sendHeartbeat();
  }
  return { ok: res.ok, data };
}

// 1-Click Disconnect and campaign pausing
async function disconnectSession() {
  const apiBase = await getApiBase();
  const stored = await chrome.storage.local.get(['access_token']);
  const headers = { 'Content-Type': 'application/json' };
  if (stored.access_token) {
    headers['Authorization'] = `Bearer ${stored.access_token}`;
  }

  const res = await fetch(`${apiBase}/agent/disconnect`, {
    method: 'POST',
    headers,
  });

  await chrome.storage.local.remove(['paired_member_id', 'account_tier']);
  return res.ok;
}

// Session expired notification (FR-1.8)
async function notifySessionExpired(reason = 'SESSION_EXPIRED') {
  const apiBase = await getApiBase();
  const stored = await chrome.storage.local.get(['access_token']);
  const headers = { 'Content-Type': 'application/json' };
  if (stored.access_token) {
    headers['Authorization'] = `Bearer ${stored.access_token}`;
  }

  await fetch(`${apiBase}/agent/session-expired`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason }),
  });
}

// Circuit breaker invocation (FR-8.8, FR-9.9)
async function triggerCircuitBreaker(reason = 'LinkedIn challenge or restriction detected.') {
  try {
    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['access_token']);
    const headers = { 'Content-Type': 'application/json' };
    if (stored.access_token) {
      headers['Authorization'] = `Bearer ${stored.access_token}`;
    }

    const res = await fetch(`${apiBase}/agent/circuit-breaker?reason=${encodeURIComponent(reason)}`, {
      method: 'POST',
      headers,
    });
    console.warn('[Agent Extension] Circuit breaker tripped:', res.status);
    return res.ok;
  } catch (err) {
    console.error('[Agent Extension] Failed to trip circuit breaker:', err);
    return false;
  }
}

// Evaluate LinkedIn profile via backend API (FR-8.6)
async function evaluateProfile(payload) {
  try {
    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['access_token']);
    const headers = { 'Content-Type': 'application/json' };
    if (stored.access_token) {
      headers['Authorization'] = `Bearer ${stored.access_token}`;
    }

    const res = await fetch(`${apiBase}/agent/evaluate-profile`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data };
    }
  } catch (err) {
    console.debug('[Agent Extension] Profile evaluation failed:', err);
  }
  return { ok: false, data: null };
}

// Action Queue Runner (FR-8.2, FR-8.3)
let isProcessingQueue = false;

async function processActionQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const tabInfo = await detectLinkedInTab();
    if (!tabInfo.hasTab) {
      return; // Executes only when browser open and LinkedIn session active (FR-8.3)
    }

    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['access_token']);
    if (!stored.access_token) return;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${stored.access_token}`,
    };

    const res = await fetch(`${apiBase}/agent/queue`, { headers });
    if (!res.ok) return;

    const queueData = await res.json();
    if (!queueData || !queueData.within_working_hours || !queueData.items || queueData.items.length === 0) {
      return;
    }

    // Pick first due action
    const nextTask = queueData.items[0];
    console.log('[Agent Extension] Dispatching queued action:', nextTask);

    // Send action to active LinkedIn tab
    chrome.tabs.sendMessage(
      tabInfo.tabId,
      {
        type: 'EXECUTE_LINKEDIN_ACTION',
        action: nextTask,
      },
      async (result) => {
        if (chrome.runtime.lastError) {
          console.debug('[Agent Extension] Tab communication error:', chrome.runtime.lastError.message);
          return;
        }

        const success = Boolean(result && result.success);
        await fetch(`${apiBase}/agent/queue/${nextTask.task_id}/report`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            success,
            result_data: result || {},
          }),
        });
        console.log('[Agent Extension] Reported action result to server:', success);
      }
    );
  } catch (err) {
    console.debug('[Agent Extension] Queue processing error:', err);
  } finally {
    isProcessingQueue = false;
  }
}

// Approval notifications (FR-8.7, FR-10.1)
let lastNotifiedPendingCount = 0;
let lastNotificationTimestamp = 0;

async function checkApprovalNotifications() {
  try {
    const now = Date.now();
    // Throttle notifications to at most once per 30 minutes
    if (now - lastNotificationTimestamp < 30 * 60 * 1000) return;

    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['access_token']);
    if (!stored.access_token) return;

    const headers = { 'Authorization': `Bearer ${stored.access_token}` };
    const res = await fetch(`${apiBase}/approvals/counts`, { headers });
    if (!res.ok) return;

    const counts = await res.json();
    const totalPending = Object.values(counts).reduce((a, b) => Number(a) + Number(b), 0);

    if (totalPending > 0 && totalPending > lastNotifiedPendingCount) {
      lastNotifiedPendingCount = totalPending;
      lastNotificationTimestamp = now;

      if (chrome.notifications) {
        chrome.notifications.create('pending_approvals', {
          type: 'basic',
          iconUrl: 'favicon.svg',
          title: 'Action Required',
          message: `${totalPending} outreach item(s) awaiting your review.`,
          priority: 1,
        });
      }
    }
  } catch (err) {
    console.debug('[Agent Extension] Approval notification check failed:', err);
  }
}

// Silent background token refresh when JWT access token expires
async function silentRefreshToken() {
  try {
    const apiBase = await getApiBase();
    const stored = await chrome.storage.local.get(['refresh_token']);
    const refreshToken = stored.refresh_token;
    if (!refreshToken) return null;

    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.access_token) {
      const updates = {
        access_token: data.access_token,
      };
      if (data.refresh_token) {
        updates.refresh_token = data.refresh_token;
      }
      await chrome.storage.local.set(updates);
      console.log('[Agent Extension] Session token refreshed silently.');
      return data.access_token;
    }
  } catch (err) {
    console.debug('[Agent Extension] Silent token refresh failed:', err);
  }
  return null;
}

// Runtime messaging dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CHECK_LINKEDIN_SESSION') {
    detectLinkedInSession()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ isLoggedIn: false, hasTab: false, error: err.message }));
    return true;
  }

  if (request.type === 'SYNC_AUTH_TOKEN') {
    // Only the web app may hand over a session, and only for its own origin.
    const senderOrigin = sender.origin || originOf(sender.url);
    const sameOrigin = (url) => !url || originOf(url) === senderOrigin;
    if (
      !TRUSTED_APP_ORIGINS.includes(senderOrigin) ||
      !sameOrigin(request.apiBase) ||
      !sameOrigin(request.webAppUrl)
    ) {
      sendResponse({ ok: false, error: 'Untrusted origin' });
      return false;
    }

    (async () => {
      try {
        if (request.token) {
          const updates = {
            access_token: request.token,
            paired_member_id: request.user?.full_name || request.user?.email || null,
          };
          if (request.refreshToken) {
            updates.refresh_token = request.refreshToken;
          }
          if (request.apiBase) {
            updates.agent_api_base = request.apiBase;
            updates.api_base = request.apiBase;
          }
          if (request.webAppUrl) {
            updates.agent_web_app_url = request.webAppUrl;
            updates.web_app_url = request.webAppUrl;
          }
          await chrome.storage.local.set(updates);
          const hb = await sendHeartbeat();
          sendResponse({ ok: true, heartbeat: hb });
        } else {
          sendResponse({ ok: false, error: 'No token' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'SEND_HEARTBEAT') {
    sendHeartbeat().then((res) => sendResponse({ success: Boolean(res), data: res }));
    return true;
  }

  if (request.type === 'PAIR_SESSION') {
    pairSession(request.payload)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'DISCONNECT') {
    disconnectSession()
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'SESSION_EXPIRED') {
    notifySessionExpired(request.reason)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'CHALLENGE_DETECTED') {
    triggerCircuitBreaker(request.reason)
      .then((ok) => sendResponse({ ok }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'EVALUATE_PROFILE') {
    evaluateProfile(request.payload)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'GET_STATUS') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['access_token', 'paired_member_id', 'account_tier']);
        const apiBase = await getApiBase();
        const headers = stored.access_token ? { Authorization: `Bearer ${stored.access_token}` } : {};
        const res = await fetch(`${apiBase}/agent/status`, { headers });
        const data = await res.json();
        sendResponse({ ok: res.ok, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_QUEUE') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['access_token']);
        const apiBase = await getApiBase();
        const headers = stored.access_token ? { Authorization: `Bearer ${stored.access_token}` } : {};
        const res = await fetch(`${apiBase}/agent/queue`, { headers });
        const data = await res.json();
        sendResponse({ ok: res.ok, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_POPUP_SUMMARY') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['access_token']);
        const apiBase = await getApiBase();
        const headers = stored.access_token ? { Authorization: `Bearer ${stored.access_token}` } : {};
        const res = await fetch(`${apiBase}/agent/popup-summary`, { headers });
        const data = await res.json();
        sendResponse({ ok: res.ok, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

