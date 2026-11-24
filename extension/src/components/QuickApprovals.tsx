import React from 'react';
import type { ApprovalItem } from '../types';

interface QuickApprovalsProps {
  items: ApprovalItem[];
  currentIndex: number;
  draftCustomText: string;
  isRegenerating: boolean;
  notice: string | null;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
  onLater: () => void;
  onRegenerate: () => void;
}

export const QuickApprovals: React.FC<QuickApprovalsProps> = ({
  items,
  currentIndex,
  draftCustomText,
  isRegenerating,
  notice,
  onBack,
  onApprove,
  onReject,
  onLater,
  onRegenerate,
}) => {
  const currentApproval = items[currentIndex];
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
    <div className="ext-screen ext-approvals-screen">
      {/* Top Bar with Back Arrow */}
      <div className="ext-approvals-header">
        <button type="button" className="ext-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="ext-approvals-title-box">
          <span className="ext-approvals-title">Approvals</span>
          <span className="ext-approvals-sub">
            {items.length} waiting · {currentIndex + 1} of {items.length || 1}
          </span>
        </div>
        <a
          href={`${webAppUrl}/approvals`}
          target="_blank"
          rel="noreferrer"
          className="ext-open-all-link"
        >
          Open all
        </a>
      </div>

      <div className="ext-content-body">
        {notice && <div className="ext-toast-notice">{notice}</div>}

        {currentApproval ? (
          <div className="ext-approval-content">
            {/* Badge & Audience */}
            <div className="ext-type-badge-row">
              <span className="ext-type-pill">{currentApproval.type}</span>
              <span className="ext-audience-text">{currentApproval.audience}</span>
            </div>

            {/* Author Info */}
            <div className="ext-author-row">
              <div className="ext-author-avatar">{currentApproval.authorInitials}</div>
              <div className="ext-author-meta">
                <span className="ext-author-name">{currentApproval.authorName}</span>
                <span className="ext-author-headline">{currentApproval.authorHeadline}</span>
              </div>
            </div>

            {/* Their Post Box */}
            <div className="ext-quote-section">
              <span className="ext-box-label">THEIR POST</span>
              <div className="ext-quote-box">{currentApproval.theirPost}</div>
            </div>

            {/* AI Draft Box */}
            <div className="ext-quote-section">
              <span className="ext-box-label">AI DRAFT</span>
              <div className="ext-draft-box">
                {draftCustomText || currentApproval.aiDraft}
              </div>
            </div>

            {/* Regenerate Action */}
            <div className="ext-regen-row">
              <button
                type="button"
                className="ext-regen-link"
                disabled={isRegenerating}
                onClick={onRegenerate}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={isRegenerating ? 'animate-spin' : ''}
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>{isRegenerating ? 'Generating new draft…' : 'Regenerate'}</span>
              </button>
            </div>

            {/* Action Buttons */}
            <div className="ext-approval-actions">
              <button type="button" className="ext-btn-reject" onClick={onReject}>
                Reject
              </button>
              <button type="button" className="ext-btn-later" onClick={onLater}>
                Later
              </button>
              <button type="button" className="ext-btn-approve" onClick={onApprove}>
                Approve
              </button>
            </div>
          </div>
        ) : (
          <div className="ext-empty-queue">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#10b981" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <h4>All approvals caught up!</h4>
            <p>New candidate comments and connection drafts will appear here as the agent works.</p>
            <button type="button" className="ext-btn-primary mt-2" onClick={onBack}>
              Return to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
