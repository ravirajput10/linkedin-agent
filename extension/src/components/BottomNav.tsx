import React from 'react';
import type { ExtensionTab } from '../types';

interface BottomNavProps {
  activeTab: ExtensionTab;
  onTabChange: (tab: ExtensionTab) => void;
  approvalCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  approvalCount,
}) => {
  return (
    <nav className="ext-bottom-nav">
      <button
        type="button"
        className={`ext-nav-item ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onTabChange('home')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Home</span>
      </button>

      <button
        type="button"
        className={`ext-nav-item ${activeTab === 'approvals' ? 'active' : ''}`}
        onClick={() => onTabChange('approvals')}
      >
        <div className="ext-nav-icon-wrapper">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          {approvalCount > 0 && (
            <span className="ext-nav-badge">{approvalCount}</span>
          )}
        </div>
        <span>Approve</span>
      </button>

      <button
        type="button"
        className={`ext-nav-item ${activeTab === 'prospect' ? 'active' : ''}`}
        onClick={() => onTabChange('prospect')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>Prospect</span>
      </button>

      <button
        type="button"
        className={`ext-nav-item ${activeTab === 'post' ? 'active' : ''}`}
        onClick={() => onTabChange('post')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span>New post</span>
      </button>
    </nav>
  );
};
