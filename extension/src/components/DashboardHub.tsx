import React, { useState, useEffect } from 'react';
import type { ConnectedProfile, ExtensionTab, DailyUsage, ApprovalItem, QueueItem } from '../types';
import { PopupHome } from './PopupHome';
import { QuickApprovals } from './QuickApprovals';
import { ProspectSidePanel } from './ProspectSidePanel';
import { PostComposer } from './PostComposer';
import { BottomNav } from './BottomNav';

import { getStoredToken } from '../storage';

function sanitizeApiBase(rawUrl?: string): string {
  const fallback =
    typeof window !== 'undefined' && window.location.hostname.includes('divergentsl.com')
      ? 'https://staging.divergentsl.com/linkedin-agent/api'
      : 'http://localhost:5173/linkedin-agent/api';
  if (!rawUrl) return fallback;
  try {
    const url = new URL(rawUrl);
    if (!url.hostname || url.hostname === 'api') {
      return fallback;
    }
    return `${url.origin}/linkedin-agent/api`;
  } catch {
    return fallback;
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
  return typeof window !== 'undefined' && window.location.hostname.includes('divergentsl.com')
    ? 'https://staging.divergentsl.com/linkedin-agent/api'
    : 'http://localhost:5173/linkedin-agent/api';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface DashboardHubProps {
  profile: ConnectedProfile;
  usage: DailyUsage;
  onDisconnect: () => void;
}

export const DashboardHub: React.FC<DashboardHubProps> = ({
  profile,
  usage: initialUsage,
  onDisconnect,
}) => {
  const [activeTab, setActiveTab] = useState<ExtensionTab>('home');
  const [isRunning, setIsRunning] = useState(true);

  // Approval items queue
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>([]);

  const [currentApprovalIndex, setCurrentApprovalIndex] = useState(0);
  const [draftCustomText, setDraftCustomText] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  // Scheduled Queue items
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // One-off actions state on prospect profile
  const [addedToAudience, setAddedToAudience] = useState(false);
  const [oneOffStatus, setOneOffStatus] = useState<string | null>(null);

  // Post composer state
  const [postTopic, setPostTopic] = useState('');
  const [postTone, setPostTone] = useState('Professional');
  const [generatedPost, setGeneratedPost] = useState('');
  const [isGeneratingPost, setIsGeneratingPost] = useState(false);
  const [copiedPost, setCopiedPost] = useState(false);

  // Daily Usage stats
  const [stats, setStats] = useState({
    actions: 0,
    accepted: 0,
    replies: 0,
  });

  const [usage, setUsage] = useState({
    likesUsed: initialUsage.likesUsed || 0,
    likesLimit: initialUsage.likesLimit || 60,
    commentsUsed: initialUsage.commentsUsed || 0,
    commentsLimit: initialUsage.commentsLimit || 20,
    connectionsUsed: initialUsage.connectionsUsed || 0,
    connectionsLimit: initialUsage.connectionsLimit || 25,
  });

  // Fetch live backend state (FR-8.4, FR-8.5)
  useEffect(() => {
    let active = true;

    async function loadLiveData() {
      try {
        const apiBase = await getApiBase();
        const headers = await getAuthHeaders();
        if (!headers['Authorization']) return;

        // 1. Popup summary
        const sumRes = await fetch(`${apiBase}/agent/popup-summary`, { headers });
        if (sumRes.ok && active) {
          const sumData = await sumRes.json();
          if (sumData.status) {
            setIsRunning(!sumData.status.campaigns_blocked);
          }
          if (sumData.usage) {
            setUsage(sumData.usage);
          }
          if (sumData.stats) {
            setStats(sumData.stats);
          }
          if (sumData.recent_queue && sumData.recent_queue.length > 0) {
            setQueue(sumData.recent_queue);
          }
        }

        // 2. Real Pending Approvals
        const appRes = await fetch(`${apiBase}/approvals?status=PENDING&page_size=20`, { headers });
        if (appRes.ok && active) {
          const appData = await appRes.json();
          if (appData.items && appData.items.length > 0) {
            interface RawApproval {
              id: number | string;
              approval_type?: string;
              campaign_name?: string;
              person?: { name?: string; headline?: string };
              post?: { content?: string };
              draft_content?: string;
              message?: string;
            }
            const mapped: ApprovalItem[] = appData.items.map((a: RawApproval) => ({
              id: String(a.id),
              type: a.approval_type === 'COMMENT' ? 'Comment' : a.approval_type === 'CONNECTION' ? 'Connection' : 'Candidate',
              audience: a.campaign_name || 'Active Campaign',
              authorName: a.person?.name || 'Prospect',
              authorHeadline: a.person?.headline || 'Professional on LinkedIn',
              authorInitials: (a.person?.name || 'P').split(' ').map((n: string) => n[0]).join('').slice(0, 2),
              theirPost: a.post?.content || 'Recent discussion on engineering and growth strategies.',
              aiDraft: a.draft_content || a.message || 'Insightful perspective — looking forward to connecting and sharing ideas!',
            }));
            setApprovalItems(mapped);
          }
        }
      } catch (err) {
        console.debug('[Agent Extension] Live data load error:', err);
      }
    }

    void loadLiveData();
    return () => {
      active = false;
    };
  }, []);

  // Approvals handlers
  const handleApprove = async () => {
    const currentItem = approvalItems[currentApprovalIndex];
    if (!currentItem) return;

    setApprovalNotice('Approved & queued for posting!');
    try {
      const apiBase = await getApiBase();
      const headers = await getAuthHeaders();
      await fetch(`${apiBase}/approvals/${currentItem.id}/approve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: draftCustomText || currentItem.aiDraft }),
      });
    } catch (err) {
      console.debug('Failed to submit approval to backend:', err);
    }

    setTimeout(() => {
      setApprovalNotice(null);
      if (currentApprovalIndex < approvalItems.length - 1) {
        setCurrentApprovalIndex(currentApprovalIndex + 1);
        setDraftCustomText('');
      } else {
        setApprovalItems([]);
      }
    }, 600);
  };

  const handleReject = async () => {
    const currentItem = approvalItems[currentApprovalIndex];
    if (!currentItem) return;

    setApprovalNotice('Item rejected.');
    try {
      const apiBase = await getApiBase();
      const headers = await getAuthHeaders();
      await fetch(`${apiBase}/approvals/${currentItem.id}/reject`, {
        method: 'POST',
        headers,
      });
    } catch (err) {
      console.debug('Failed to submit rejection to backend:', err);
    }

    setTimeout(() => {
      setApprovalNotice(null);
      if (currentApprovalIndex < approvalItems.length - 1) {
        setCurrentApprovalIndex(currentApprovalIndex + 1);
        setDraftCustomText('');
      } else {
        setApprovalItems([]);
      }
    }, 600);
  };

  const handleToggleRunning = async () => {
    const nextState = !isRunning;
    setIsRunning(nextState);

    try {
      const apiBase = await getApiBase();
      const headers = await getAuthHeaders();
      const endpoint = nextState ? `${apiBase}/agent/resume-all` : `${apiBase}/agent/pause-all`;
      await fetch(endpoint, { method: 'POST', headers });
    } catch (err) {
      console.debug('Failed to toggle automation state:', err);
    }
  };

  const handleLater = () => {
    if (currentApprovalIndex < approvalItems.length - 1) {
      setCurrentApprovalIndex(currentApprovalIndex + 1);
      setDraftCustomText('');
    } else {
      setCurrentApprovalIndex(0);
    }
  };

  const handleRegenerate = async () => {
    const currentItem = approvalItems[currentApprovalIndex];
    if (!currentItem) return;

    setIsRegenerating(true);
    try {
      const apiBase = await getApiBase();
      const headers = await getAuthHeaders();
      const res = await fetch(`${apiBase}/approvals/${currentItem.id}/regenerate`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draft_content) {
          setDraftCustomText(data.draft_content);
          return;
        }
      }
      setApprovalNotice('Could not regenerate draft at this time.');
    } catch (err) {
      console.debug('Backend regeneration failed:', err);
      setApprovalNotice('Network error during draft regeneration.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Post composer handlers
  const handleGeneratePost = async () => {
    if (!postTopic.trim()) return;
    setIsGeneratingPost(true);
    try {
      const apiBase = await getApiBase();
      const headers = await getAuthHeaders();
      const res = await fetch(`${apiBase}/content-studio/generate-drafts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          topic: postTopic,
          tone: postTone.toLowerCase(),
          draft_count: 1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.drafts && data.drafts.length > 0) {
          setGeneratedPost(data.drafts[0].content);
          return;
        }
      }
    } catch (err) {
      console.debug('[Agent Extension] Failed to generate post from API:', err);
    } finally {
      setIsGeneratingPost(false);
    }
  };

  const handleCopyPost = () => {
    navigator.clipboard.writeText(generatedPost);
    setCopiedPost(true);
    setTimeout(() => setCopiedPost(false), 2000);
  };

  return (
    <div className="ext-wrapper">
      {/* 1. Popup Home Screen */}
      {activeTab === 'home' && (
        <PopupHome
          profile={profile}
          usage={usage}
          stats={stats}
          queue={queue}
          approvalCount={approvalItems.length}
          isRunning={isRunning}
          onToggleRunning={handleToggleRunning}
          onReviewApprovals={() => setActiveTab('approvals')}
          onDisconnect={onDisconnect}
        />
      )}

      {/* 2. Quick Approvals Screen */}
      {activeTab === 'approvals' && (
        <QuickApprovals
          items={approvalItems}
          currentIndex={currentApprovalIndex}
          draftCustomText={draftCustomText}
          isRegenerating={isRegenerating}
          notice={approvalNotice}
          onBack={() => setActiveTab('home')}
          onApprove={handleApprove}
          onReject={handleReject}
          onLater={handleLater}
          onRegenerate={handleRegenerate}
        />
      )}

      {/* 3. Side Panel on a Profile Screen */}
      {activeTab === 'prospect' && (
        <ProspectSidePanel
          addedToAudience={addedToAudience}
          oneOffStatus={oneOffStatus}
          onAddToAudience={() => {
            setAddedToAudience(true);
            setTimeout(() => setAddedToAudience(false), 3000);
          }}
          onOneOffAction={(msg) => {
            setOneOffStatus(msg);
            setTimeout(() => setOneOffStatus(null), 2000);
          }}
        />
      )}

      {/* 4. AI Post Composer Screen */}
      {activeTab === 'post' && (
        <PostComposer
          postTopic={postTopic}
          postTone={postTone}
          generatedPost={generatedPost}
          isGeneratingPost={isGeneratingPost}
          copiedPost={copiedPost}
          onTopicChange={setPostTopic}
          onToneChange={setPostTone}
          onGeneratePost={handleGeneratePost}
          onCopyPost={handleCopyPost}
        />
      )}

      {/* Fixed Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        approvalCount={approvalItems.length}
      />
    </div>
  );
};

export default DashboardHub;
