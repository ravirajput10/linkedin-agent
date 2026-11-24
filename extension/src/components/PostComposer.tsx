import React from 'react';

interface PostComposerProps {
  postTopic: string;
  postTone: string;
  generatedPost: string;
  isGeneratingPost: boolean;
  copiedPost: boolean;
  onTopicChange: (val: string) => void;
  onToneChange: (val: string) => void;
  onGeneratePost: () => void;
  onCopyPost: () => void;
}

export const PostComposer: React.FC<PostComposerProps> = ({
  postTopic,
  postTone,
  generatedPost,
  isGeneratingPost,
  copiedPost,
  onTopicChange,
  onToneChange,
  onGeneratePost,
  onCopyPost,
}) => {
  return (
    <div className="ext-screen ext-post-screen">
      <div className="ext-header-dark">
        <div className="ext-header-left">
          <div className="ext-logo-icon">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <div className="ext-brand-title">AI Post Composer</div>
        </div>
        <span className="ext-side-label">New post</span>
      </div>

      <div className="ext-content-body">
        <div className="ext-section-card">
          <div className="ext-section-header">IDEA OR TOPIC</div>
          <textarea
            className="ext-textarea"
            rows={3}
            placeholder="What do you want to share today? (e.g. Scaling LLM evals in production)"
            value={postTopic}
            onChange={(e) => onTopicChange(e.target.value)}
          />

          <div className="ext-composer-options">
            <label className="ext-option-label">Tone:</label>
            <select
              value={postTone}
              onChange={(e) => onToneChange(e.target.value)}
              className="ext-select-tone"
            >
              <option value="Professional">Professional</option>
              <option value="Storytelling">Storytelling</option>
              <option value="Technical">Technical</option>
              <option value="Casual">Casual</option>
            </select>
          </div>

          <button
            type="button"
            className="ext-btn-primary w-full mt-2"
            disabled={!postTopic.trim() || isGeneratingPost}
            onClick={onGeneratePost}
          >
            {isGeneratingPost ? 'Generating with AI…' : 'Generate with AI'}
          </button>
        </div>

        {generatedPost && (
          <div className="ext-section-card">
            <div className="ext-section-header">DRAFT PREVIEW</div>
            <div className="ext-draft-preview-box">{generatedPost}</div>
            <div className="ext-post-actions-row">
              <button type="button" className="ext-btn-secondary" onClick={onCopyPost}>
                {copiedPost ? 'Copied ✓' : 'Copy Post'}
              </button>
              <a
                href="https://www.linkedin.com/feed/"
                target="_blank"
                rel="noreferrer"
                className="ext-btn-primary"
              >
                Open in LinkedIn &rsaquo;
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
