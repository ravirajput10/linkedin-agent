import React from 'react';

interface ProspectSidePanelProps {
  addedToAudience: boolean;
  oneOffStatus: string | null;
  onAddToAudience: () => void;
  onOneOffAction: (msg: string) => void;
}

export const ProspectSidePanel: React.FC<ProspectSidePanelProps> = ({
  addedToAudience,
  oneOffStatus,
  onAddToAudience,
  onOneOffAction,
}) => {
  return (
    <div className="ext-screen ext-prospect-screen">
      {/* Top Header */}
      <div className="ext-header-dark">
        <div className="ext-header-left">
          <div className="ext-logo-icon">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="currentColor">
              <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
            </svg>
          </div>
          <div className="ext-brand-title">Viewing a profile</div>
        </div>
        <span className="ext-side-label">Side panel</span>
      </div>

      <div className="ext-content-body">
        {/* Prospect Header Card */}
        <div className="ext-section-card">
          <div className="ext-prospect-header">
            <div className="ext-prospect-avatar-kg">KG</div>
            <div className="ext-prospect-info">
              <span className="ext-prospect-name">Karan Gupta</span>
              <span className="ext-prospect-sub">
                Co-founder, CTO · Pipecraft · Bengaluru
              </span>
            </div>
            <div className="ext-fit-badge">
              <span className="ext-fit-score">86</span>
              <span className="ext-fit-label">FIT</span>
            </div>
          </div>

          {/* Match Criteria Chips */}
          <div className="ext-chips-row">
            <span className="ext-match-chip">Title matches</span>
            <span className="ext-match-chip">B2B SaaS · 140 staff</span>
            <span className="ext-match-chip">Posts about LLM evals</span>
          </div>

          <p className="ext-audience-match-note">
            Matches audience <strong>SaaS founders · India</strong> · not in a campaign yet
          </p>

          <div className="ext-audience-select-row">
            <select className="ext-select-audience" aria-label="Target audience">
              <option>SaaS founders · India</option>
              <option>AI Founders - Seed to Series A</option>
              <option>Bengaluru Tech Leaders</option>
            </select>
            <button
              type="button"
              className="ext-btn-add"
              disabled={addedToAudience}
              onClick={onAddToAudience}
            >
              {addedToAudience ? 'Added ✓' : 'Add'}
            </button>
          </div>
        </div>

        {/* DO IT NOW (ONE-OFF) */}
        <div className="ext-section-card">
          <div className="ext-section-header">DO IT NOW (ONE-OFF)</div>
          {oneOffStatus && <div className="ext-toast-mini">{oneOffStatus}</div>}
          <div className="ext-one-off-row">
            <button
              type="button"
              className="ext-btn-one-off"
              onClick={() => onOneOffAction('Liked latest post!')}
            >
              Like latest
            </button>
            <button
              type="button"
              className="ext-btn-one-off"
              onClick={() => onOneOffAction('Drafting AI comment on latest post…')}
            >
              AI comment
            </button>
            <button
              type="button"
              className="ext-btn-one-off"
              onClick={() => onOneOffAction('Connection invite dispatched!')}
            >
              Connect
            </button>
          </div>
        </div>

        {/* RECENT POSTS */}
        <div className="ext-section-card">
          <div className="ext-section-header">RECENT POSTS</div>
          <div className="ext-recent-post-item">
            <p className="ext-post-preview-text">
              We replaced 40% of our manual QA with LLM-graded evals. Here’s what broke first…
            </p>
            <div className="ext-post-meta-row">
              <span className="ext-post-date">6 days ago · 212 reactions</span>
              <button
                type="button"
                className="ext-draft-comment-link"
                onClick={() => onOneOffAction('Comment drafted for Post #1')}
              >
                Draft comment
              </button>
            </div>
          </div>

          <div className="ext-recent-post-divider" />

          <div className="ext-recent-post-item">
            <p className="ext-post-preview-text">
              Pipecraft is hiring 4 backend engineers in Bengaluru. DM me if you love data pipelines.
            </p>
            <div className="ext-post-meta-row">
              <span className="ext-post-date">2 weeks ago · 96 reactions</span>
              <button
                type="button"
                className="ext-draft-comment-link"
                onClick={() => onOneOffAction('Comment drafted for Post #2')}
              >
                Draft comment
              </button>
            </div>
          </div>
        </div>

        {/* HISTORY WITH KARAN */}
        <div className="ext-section-card mb-2">
          <div className="ext-section-header">HISTORY WITH KARAN</div>
          <p className="ext-history-text">
            No interactions yet. Adding him to a campaign starts with liking 2 posts.
          </p>
        </div>
      </div>
    </div>
  );
};
