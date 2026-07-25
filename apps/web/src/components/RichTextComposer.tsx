"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MAX_CONTENT_LENGTH = 280;
const WARNING_THRESHOLD = 260;

interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
}

interface PollOption {
  id: string;
  text: string;
}

interface RichTextComposerProps {
  onSubmit: (content: string, attachments?: File[], poll?: PollOption[]) => void;
  onCancel?: () => void;
  placeholder?: string;
  disabled?: boolean;
  users?: User[];
}

export function RichTextComposer({
  onSubmit,
  onCancel,
  placeholder = "What's happening?",
  disabled = false,
  users = [],
}: RichTextComposerProps) {
  const [content, setContent] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState<PollOption[]>([
    { id: "1", text: "" },
    { id: "2", text: "" },
  ]);
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);

  const charCount = content.length;
  const isNearLimit = charCount >= WARNING_THRESHOLD && charCount <= MAX_CONTENT_LENGTH;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isEmpty = content.trim().length === 0;
  const isDisabled = isEmpty || isOverLimit || disabled || isSubmitting;

  // Filter users for mention autocomplete
  useEffect(() => {
    if (mentionQuery.length > 0) {
      const filtered = users.filter(
        (user) =>
          user.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          user.displayName.toLowerCase().includes(mentionQuery.toLowerCase())
      );
      setFilteredUsers(filtered.slice(0, 5));
      setShowMentionDropdown(filtered.length > 0);
    } else {
      setShowMentionDropdown(false);
    }
  }, [mentionQuery, users]);

  // Close mention dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mentionDropdownRef.current &&
        !mentionDropdownRef.current.contains(event.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(event.target as Node)
      ) {
        setShowMentionDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle content changes with mention/hashtag detection
  const handleContentChange = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const newContent = e.currentTarget.innerText ?? e.currentTarget.textContent ?? "";

    if (newContent.length <= MAX_CONTENT_LENGTH) {
      setContent(newContent);

      // Detect @mention
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const textBeforeCursor = newContent.substring(0, range.startOffset);

        const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
        if (mentionMatch) {
          setMentionQuery(mentionMatch[1]);
          setMentionIndex(0);
        } else {
          setShowMentionDropdown(false);
          setMentionQuery("");
        }
      }
    }
  }, []);

  // Insert mention
  const insertMention = useCallback(
    (user: User) => {
      if (!editorRef.current) return;

      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const textBeforeCursor = content.substring(0, range.startOffset);
        const mentionStart = textBeforeCursor.lastIndexOf("@");

        // Remove the @ and query, insert the mention
        const beforeMention = content.substring(0, mentionStart);
        const afterCursor = content.substring(range.startOffset);
        const newContent = beforeMention + `@${user.username} ` + afterCursor;

        setContent(newContent);
        setShowMentionDropdown(false);
        setMentionQuery("");

        // Restore cursor position
        editorRef.current.innerText = newContent;
        const newRange = document.createRange();
        const newCursorPos = beforeMention.length + `@${user.username} `.length;
        newRange.setStart(editorRef.current.firstChild || editorRef.current, newCursorPos);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
    },
    [content]
  );

  // Handle keyboard navigation in mention dropdown
  const handleMentionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showMentionDropdown) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredUsers[mentionIndex]) {
          insertMention(filteredUsers[mentionIndex]);
        }
      } else if (e.key === "Escape") {
        setShowMentionDropdown(false);
      }
    },
    [showMentionDropdown, filteredUsers, mentionIndex, insertMention]
  );

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );

    if (validFiles.length > 0) {
      setAttachments((prev) => [...prev, ...validFiles]);

      // Create previews
      validFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setAttachmentPreviews((prev) => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  }, []);

  // Remove attachment
  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Handle poll option changes
  const handlePollOptionChange = useCallback((id: string, value: string) => {
    setPollOptions((prev) =>
      prev.map((option) => (option.id === id ? { ...option, text: value } : option))
    );
  }, []);

  // Add poll option
  const addPollOption = useCallback(() => {
    if (pollOptions.length < 4) {
      setPollOptions((prev) => [...prev, { id: Date.now().toString(), text: "" }]);
    }
  }, [pollOptions.length]);

  // Remove poll option
  const removePollOption = useCallback(
    (id: string) => {
      if (pollOptions.length > 2) {
        setPollOptions((prev) => prev.filter((option) => option.id !== id));
      }
    },
    [pollOptions.length]
  );

  // Format content with highlights
  const formatContent = useCallback((text: string) => {
    // Highlight mentions
    let formatted = text.replace(/@(\w+)/g, '<span class="mention-highlight">@$1</span>');
    // Highlight hashtags
    formatted = formatted.replace(/#(\w+)/g, '<span class="hashtag-highlight">#$1</span>');
    return formatted;
  }, []);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (isDisabled) return;

    setIsSubmitting(true);
    try {
      const pollData = showPoll
        ? pollOptions.filter((opt) => opt.text.trim().length > 0)
        : undefined;
      await onSubmit(content, attachments.length > 0 ? attachments : undefined, pollData);

      // Reset form
      setContent("");
      setAttachments([]);
      setAttachmentPreviews([]);
      setShowPoll(false);
      setPollOptions([
        { id: "1", text: "" },
        { id: "2", text: "" },
      ]);
      setShowPreview(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [isDisabled, content, attachments, showPoll, pollOptions, onSubmit]);

  // Render content with highlights
  const renderContent = () => {
    if (!content) return null;

    const parts = content.split(/(@\w+|#\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith("@")) {
        return (
          <span key={index} className="mention-highlight">
            {part}
          </span>
        );
      }
      if (part.startsWith("#")) {
        return (
          <span key={index} className="hashtag-highlight">
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="rich-text-composer">
      {/* Toolbar */}
      <div className="composer-toolbar">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="toolbar-btn"
          disabled={disabled}
          title="Add media"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => setShowPoll(!showPoll)}
          className="toolbar-btn"
          disabled={disabled}
          title="Add poll"
        >
          📊
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="toolbar-btn"
          disabled={disabled || !content}
          title="Preview"
        >
          👁️
        </button>
      </div>

      {/* Editor or Preview */}
      {!showPreview ? (
        <div
          ref={editorRef}
          contentEditable
          onInput={handleContentChange}
          onKeyDown={handleMentionKeyDown}
          className="composer-editor"
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: formatContent(content) }}
          data-placeholder={placeholder}
          disabled={disabled}
        />
      ) : (
        <div className="composer-preview">
          <div className="preview-label">Preview</div>
          <div className="preview-content">{renderContent()}</div>
        </div>
      )}

      {/* Mention Dropdown */}
      {showMentionDropdown && (
        <div ref={mentionDropdownRef} className="mention-dropdown">
          {filteredUsers.map((user, index) => (
            <button
              key={user.id}
              type="button"
              className={`mention-option ${index === mentionIndex ? "selected" : ""}`}
              onClick={() => insertMention(user)}
              onMouseEnter={() => setMentionIndex(index)}
            >
              <div className="mention-avatar">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.username} />
                ) : (
                  <span>{user.username.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="mention-info">
                <div className="mention-name">{user.displayName}</div>
                <div className="mention-username">@{user.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Attachments Preview */}
      {attachmentPreviews.length > 0 && (
        <div className="attachments-preview">
          {attachmentPreviews.map((preview, index) => (
            <div key={index} className="attachment-item">
              <img src={preview} alt={`Attachment ${index + 1}`} />
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                className="attachment-remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Poll Creator */}
      {showPoll && (
        <div className="poll-creator">
          <div className="poll-label">Poll</div>
          {pollOptions.map((option, index) => (
            <div key={option.id} className="poll-option">
              <span className="poll-option-number">{index + 1}</span>
              <input
                type="text"
                value={option.text}
                onChange={(e) => handlePollOptionChange(option.id, e.target.value)}
                placeholder={`Option ${index + 1}`}
                className="poll-option-input"
                maxLength={25}
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  onClick={() => removePollOption(option.id)}
                  className="poll-option-remove"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 4 && (
            <button type="button" onClick={addPollOption} className="poll-add-option">
              + Add option
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="composer-footer">
        {/* Character Counter */}
        <div
          className={`char-counter ${isNearLimit ? "warning" : ""} ${isOverLimit ? "error" : ""}`}
        >
          {charCount}/{MAX_CONTENT_LENGTH}
        </div>

        {/* Actions */}
        <div className="composer-actions">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={isSubmitting} className="cancel-btn">
              Cancel
            </button>
          )}
          <button type="button" onClick={handleSubmit} disabled={isDisabled} className="submit-btn">
            {isSubmitting ? "Posting..." : "Post"}
          </button>
        </div>
      </div>

      <style jsx>{`
        .rich-text-composer {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 12px;
        }

        .composer-toolbar {
          display: flex;
          gap: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
        }

        .toolbar-btn {
          padding: 8px 12px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          cursor: pointer;
          font-size: 1.1rem;
          transition: all 0.2s;
        }

        .toolbar-btn:hover:not(:disabled) {
          background: var(--color-surface-2);
        }

        .toolbar-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .composer-editor {
          min-height: 120px;
          padding: 12px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          font-size: 1rem;
          line-height: 1.5;
          outline: none;
          overflow-y: auto;
        }

        .composer-editor:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 2px var(--color-primary-light);
        }

        .composer-editor:empty:before {
          content: attr(data-placeholder);
          color: var(--color-text-disabled);
        }

        .mention-highlight {
          color: var(--color-primary);
          font-weight: 600;
          background: var(--color-primary-light);
          padding: 2px 4px;
          border-radius: 4px;
        }

        .hashtag-highlight {
          color: var(--color-secondary);
          font-weight: 600;
          background: var(--color-secondary-light);
          padding: 2px 4px;
          border-radius: 4px;
        }

        .mention-dropdown {
          position: absolute;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          max-height: 200px;
          overflow-y: auto;
          z-index: 100;
          width: 280px;
        }

        .mention-option {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: transparent;
          border: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          transition: background 0.2s;
        }

        .mention-option:hover,
        .mention-option.selected {
          background: var(--color-surface-1);
        }

        .mention-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--color-primary);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 600;
          overflow: hidden;
        }

        .mention-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .mention-info {
          flex: 1;
        }

        .mention-name {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--color-text-primary);
        }

        .mention-username {
          font-size: 0.8rem;
          color: var(--color-text-secondary);
        }

        .composer-preview {
          padding: 12px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-border);
          border-radius: 8px;
        }

        .preview-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
        }

        .preview-content {
          font-size: 1rem;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .attachments-preview {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 8px;
        }

        .attachment-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 8px;
          overflow: hidden;
        }

        .attachment-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .attachment-remove {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 24px;
          height: 24px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .poll-creator {
          padding: 12px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-border);
          border-radius: 8px;
        }

        .poll-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
        }

        .poll-option {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .poll-option-number {
          width: 24px;
          height: 24px;
          background: var(--color-primary);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .poll-option-input {
          flex: 1;
          padding: 8px 12px;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-size: 0.9rem;
          outline: none;
        }

        .poll-option-input:focus {
          border-color: var(--color-primary);
        }

        .poll-option-remove {
          width: 24px;
          height: 24px;
          background: transparent;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 0.9rem;
        }

        .poll-option-remove:hover {
          color: var(--color-error);
        }

        .poll-add-option {
          padding: 8px 12px;
          background: transparent;
          border: 1px dashed var(--color-border);
          border-radius: 6px;
          color: var(--color-primary);
          font-size: 0.85rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .poll-add-option:hover {
          border-color: var(--color-primary);
          background: var(--color-primary-light);
        }

        .composer-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }

        .char-counter {
          font-family: monospace;
          font-size: 0.85rem;
          color: var(--color-text-secondary);
        }

        .char-counter.warning {
          color: var(--color-warning);
        }

        .char-counter.error {
          color: var(--color-error);
        }

        .composer-actions {
          display: flex;
          gap: 8px;
        }

        .cancel-btn {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 20px;
          color: var(--color-text-primary);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .cancel-btn:hover {
          background: var(--color-surface-1);
        }

        .submit-btn {
          padding: 8px 24px;
          background: var(--color-primary);
          border: none;
          border-radius: 20px;
          color: white;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .submit-btn:hover:not(:disabled) {
          background: var(--color-primary-hover);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
