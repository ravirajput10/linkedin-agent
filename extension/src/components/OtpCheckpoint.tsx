import React, { useState } from 'react';
import type { CheckpointData } from '../types';

interface OtpCheckpointProps {
  checkpoint: CheckpointData;
  onSubmitOtp: (code: string) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
  error?: string | null;
}

export const OtpCheckpoint: React.FC<OtpCheckpointProps> = ({
  checkpoint,
  onSubmitOtp,
  onCancel,
  isLoading,
  error,
}) => {
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmitOtp(code.trim());
  };

  return (
    <div className="auth-card checkpoint-card">
      <div className="checkpoint-icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>

      <h2>Security Verification</h2>
      <p className="subtitle">
        {checkpoint.message ||
          'LinkedIn sent a verification PIN to your email or mobile device. Enter the code below to complete linking.'}
      </p>

      {error && (
        <div className="alert-error">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-group">
        <div className="field">
          <label htmlFor="otpCode">6-Digit Verification Code</label>
          <input
            id="otpCode"
            type="text"
            required
            autoFocus
            maxLength={8}
            placeholder="e.g. 123456"
            className="otp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
            disabled={isLoading}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={isLoading || code.length < 4}>
          {isLoading ? (
            <span className="spinner-text">
              <span className="spinner"></span> Verifying Code...
            </span>
          ) : (
            'Confirm & Complete Link'
          )}
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel & Try Again
        </button>
      </form>

      <div className="checkpoint-info-box">
        <div className="checkpoint-info-title">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          <span>Direct LinkedIn Security Verification</span>
        </div>
        <p>Your PIN code is sent directly from LinkedIn's authentication servers. Once confirmed, your session token is encrypted and synced with Unipile.</p>
        <span className="checkpoint-demo-hint">Demo test: Enter any 6 digits (e.g. 123456) to proceed, or 000000 to test error handling.</span>
      </div>
    </div>
  );
};
