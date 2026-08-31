"use client";

import React, { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { validateUsername } from "@/lib/validate";

interface ProfileStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function ProfileStep({ onNext, onBack, onSkip }: ProfileStepProps) {
  const { address } = useWallet();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [usernameError, setUsernameError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    const result = validateUsername(value);
    setUsernameError(result.valid ? "" : result.error || "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const usernameResult = validateUsername(username);
    if (!usernameResult.valid) {
      setUsernameError(usernameResult.error || "Invalid username");
      return;
    }

    setSubmitting(true);
    try {
      // TODO: Save profile to contract/backend
      // For now, store locally
      const profileData = {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        bio: bio.trim(),
        avatar: avatar.trim(),
        address,
      };
      localStorage.setItem("linkora_profile_draft", JSON.stringify(profileData));

      console.log("Profile saved (draft)", profileData);
      onNext();
    } catch (error) {
      console.error("Failed to save profile", error);
      alert("Failed to save profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-8 px-6">
      <div className="mb-8 text-center">
        <div className="text-6xl mb-4">👤</div>
        <h2 className="text-3xl font-bold mb-2">Create Your Profile</h2>
        <p className="text-[var(--text-muted)]">
          Tell the community who you are
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Avatar Preview */}
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-4xl font-bold shadow-lg">
            {displayName ? displayName.charAt(0).toUpperCase() : username ? username.charAt(0).toUpperCase() : "?"}
          </div>
        </div>

        {/* Username */}
        <div>
          <label htmlFor="username" className="block text-sm font-medium mb-2">
            Username <span className="text-red-500">*</span>
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            placeholder="e.g. alice_stellar"
            required
            className={`w-full px-4 py-3 rounded-lg border ${
              usernameError
                ? "border-red-500 focus:ring-red-500"
                : "border-[var(--border)] focus:ring-violet-500"
            } focus:outline-none focus:ring-2 bg-[var(--background)] text-[var(--text)]`}
          />
          {usernameError && (
            <p className="text-red-500 text-sm mt-1">{usernameError}</p>
          )}
        </div>

        {/* Display Name */}
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium mb-2">
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alice Johnson"
            className="w-full px-4 py-3 rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--background)] text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Optional - defaults to your username
          </p>
        </div>

        {/* Bio */}
        <div>
          <label htmlFor="bio" className="block text-sm font-medium mb-2">
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell us about yourself..."
            rows={4}
            maxLength={200}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none bg-[var(--background)] text-[var(--text)]"
          />
          <div className="flex justify-between mt-1">
            <p className="text-xs text-[var(--text-muted)]">Optional</p>
            <p className="text-xs text-[var(--text-muted)]">{bio.length}/200</p>
          </div>
        </div>

        {/* Avatar URL */}
        <div>
          <label htmlFor="avatar" className="block text-sm font-medium mb-2">
            Avatar URL
          </label>
          <input
            id="avatar"
            type="url"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://example.com/avatar.jpg"
            className="w-full px-4 py-3 rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--background)] text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Optional - link to your profile picture
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 pt-6">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={submitting || !username || !!usernameError}
            className="flex-1 px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {submitting ? "Saving..." : "Continue"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="px-6 py-3 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Skip
          </button>
        </div>
      </form>
    </div>
  );
}
