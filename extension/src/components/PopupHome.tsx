import React from 'react';
import type { ConnectedProfile, DailyUsage, QueueItem } from '../types';

interface PopupHomeProps {
  profile: ConnectedProfile;
  usage: DailyUsage;
  stats: { actions: number; accepted: number; replies: number };
  queue: QueueItem[];
  approvalCount: number;
  isRunning: boolean;
  onToggleRunning: () => void;
  onReviewApprovals: () => void;
  onDisconnect: () => void;
}

export const PopupHome: React.FC<PopupHomeProps> = ({
  profile,
  usage,
  stats,
  queue,
  approvalCount,
  isRunning,
  onToggleRunning,
  onReviewApprovals,
  onDisconnect,
}) => {
  const [webAppUrl, setWebAppUrl] = React.useState<string>(
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WEB_APP_URL || 'http://localhost:5173'
  );

  React.useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['agent_web_app_url', 'web_app_url'], (res) => {
        if (res && (res.agent_web_app_url || res.web_app_url)) {
          setWebAppUrl(String(res.agent_web_app_url || res.web_app_url));
        }
      });
    }
  }, []);

  return (
    <div className="ext-screen ext-home-screen">
      {/* Top Dark Header */}
      <div className="ext-header-dark">
        <div className="ext-header-left">
          <div className="ext-logo-icon">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor">
              <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
            </svg>
          </div>
          <div>
            <div className="ext-brand-title">AI Agent</div>
            <div className="ext-status-line">
              <span className={`ext-status-dot ${isRunning ? 'running' : 'paused'}`} />
              <span>{isRunning ? 'Running · until 18:00' : 'Paused by user'}</span>
            </div>
          </div>
        </div>

        <div className="ext-header-actions">
          <button
            type="button"
            className="ext-icon-btn"
            title={isRunning ? 'Pause Agent' : 'Resume Agent'}
            onClick={onToggleRunning}
          >
            {isRunning ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <a
            href={webAppUrl}
            target="_blank"
            rel="noreferrer"
            className="ext-icon-btn"
            title="Open Web Dashboard"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          <button
            type="button"
            className="ext-icon-btn"
            title={`Disconnect ${profile.name || 'Account'}`}
            onClick={onDisconnect}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="ext-content-body">
        {/* Approval Alert Banner */}
        {approvalCount > 0 && (
          <div className="ext-banner-alert" onClick={onReviewApprovals}>
            <div className="ext-banner-left">
              <span className="ext-banner-count">{approvalCount}</span>
              <span className="ext-banner-text">items waiting for your approval</span>
            </div>
            <button type="button" className="ext-banner-link">Review &rsaquo;</button>
          </div>
        )}

        {/* 3-KPI Grid */}
        <div className="ext-kpi-grid">
          <div className="ext-kpi-card">
            <span className="ext-kpi-label">ACTIONS</span>
            <span className="ext-kpi-val">{stats.actions}</span>
          </div>
          <div className="ext-kpi-card">
            <span className="ext-kpi-label">ACCEPTED</span>
            <span className="ext-kpi-val">{stats.accepted}</span>
          </div>
          <div className="ext-kpi-card">
            <span className="ext-kpi-label">REPLIES</span>
            <span className="ext-kpi-val">{stats.replies}</span>
          </div>
        </div>

        {/* Today's Limits */}
        <div className="ext-section-card">
          <div className="ext-section-header">TODAY&apos;S LIMITS</div>
          <div className="ext-limit-row">
            <span className="ext-limit-name">Likes</span>
            <div className="ext-progress-track">
              <div
                className="ext-progress-fill"
                style={{ width: `${(usage.likesUsed / usage.likesLimit) * 100}%` }}
              />
            </div>
            <span className="ext-limit-ratio">
              {usage.likesUsed}/{usage.likesLimit}
            </span>
          </div>

          <div className="ext-limit-row">
            <span className="ext-limit-name">Comments</span>
            <div className="ext-progress-track">
              <div
                className="ext-progress-fill"
                style={{ width: `${(usage.commentsUsed / usage.commentsLimit) * 100}%` }}
              />
            </div>
            <span className="ext-limit-ratio">
              {usage.commentsUsed}/{usage.commentsLimit}
            </span>
          </div>

          <div className="ext-limit-row">
            <span className="ext-limit-name">Connections</span>
            <div className="ext-progress-track">
              <div
                className="ext-progress-fill"
                style={{ width: `${(usage.connectionsUsed / usage.connectionsLimit) * 100}%` }}
              />
            </div>
            <span className="ext-limit-ratio">
              {usage.connectionsUsed}/{usage.connectionsLimit}
            </span>
          </div>
        </div>

        {/* Up Next List */}
        <div className="ext-section-card">
          <div className="ext-section-header">UP NEXT</div>
          <div className="ext-queue-list">
            {queue.length > 0 ? (
              queue.map((item) => (
                <div key={item.id} className="ext-queue-item">
                  <span className={`ext-action-pill pill-${item.action.toLowerCase()}`}>
                    {item.action}
                  </span>
                  <span className="ext-queue-target truncate">
                    {item.target} · {item.company}
                  </span>
                  <span className="ext-queue-time">{item.timeStr}</span>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '14px 8px', color: '#64748b', fontSize: '11px' }}>
                No automated actions currently scheduled
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
