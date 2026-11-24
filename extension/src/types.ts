export type AuthState = 
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CHECKPOINT_REQUIRED'
  | 'CONNECTED';

export interface CheckpointData {
  type: 'EMAIL_OTP' | 'SMS_OTP' | 'TOTP' | 'CAPTCHA' | 'UNKNOWN';
  message?: string;
  checkpointId?: string;
}

export interface ConnectedProfile {
  name: string;
  headline?: string;
  email: string;
  avatarUrl?: string;
  unipileAccountId: string;
  accountTier?: string;
  connectedAt: string;
}

export interface DailyUsage {
  likesUsed: number;
  likesLimit: number;
  commentsUsed: number;
  commentsLimit: number;
  connectionsUsed: number;
  connectionsLimit: number;
}

export type ExtensionTab = 'home' | 'approvals' | 'prospect' | 'post';

export interface ApprovalItem {
  id: string;
  type: string;
  audience: string;
  authorName: string;
  authorHeadline: string;
  authorInitials: string;
  theirPost: string;
  aiDraft: string;
}

export interface QueueItem {
  id: string;
  action: 'Like' | 'Connect' | 'Comment';
  target: string;
  company: string;
  timeStr: string;
}
