"use client";

import React, { useState } from "react";

interface NotificationPreference {
  id: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
}

interface NotificationStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function NotificationStep({ onNext, onBack, onSkip }: NotificationStepProps) {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([
    {
      id: "newFollowers",
      label: "New Followers",
      description: "Get notified when someone follows you",
      icon: "👥",
      enabled: true,
    },
    {
      id: "likes",
      label: "Likes",
      description: "Get notified when someone likes your posts",
      icon: "❤️",
      enabled: true,
    },
    {
      id: "comments",
      label: "Comments & Replies",
      description: "Get notified when someone comments on your posts",
      icon: "💬",
      enabled: true,
    },
    {
      id: "tips",
      label: "Tips Received",
      description: "Get notified when you receive tips",
      icon: "💰",
      enabled: true,
    },
    {
      id: "governance",
      label: "Governance Updates",
      description: "Get notified about governance proposals and votes",
      icon: "🗳️",
      enabled: false,
    },
  ]);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const togglePreference = (id: string) => {
    setPreferences((prev) =>
      prev.map((pref) =>
        pref.id === id ? { ...pref, enabled: !pref.enabled } : pref
      )
    );
  };

  const handleEnablePush = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setPushEnabled(true);
      } else {
        alert("Push notifications permission denied. You can enable them later in settings.");
      }
    }
  };

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      // Save preferences to localStorage
      const prefs = {
        pushEnabled,
        preferences: preferences.reduce(
          (acc, pref) => ({ ...acc, [pref.id]: pref.enabled }),
          {}
        ),
      };
      localStorage.setItem("linkora_notification_prefs", JSON.stringify(prefs));

      console.log("Notification preferences saved", prefs);
      onNext();
    } catch (error) {
      console.error("Failed to save notification preferences", error);
      alert("Failed to save preferences. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-8 px-6">
      <div className="mb-8 text-center">
        <div className="text-6xl mb-4">🔔</div>
        <h2 className="text-3xl font-bold mb-2">Notification Preferences</h2>
        <p className="text-[var(--text-muted)]">
          Choose what updates you want to receive
        </p>
      </div>

      <div className="space-y-6">
        {/* Push Notifications Toggle */}
        <div className="p-4 rounded-lg bg-[var(--muted)] border border-[var(--border)]">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">📱</span>
                <h3 className="font-semibold text-lg">
                  Enable Push Notifications
                </h3>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Receive real-time notifications on your device
              </p>
            </div>
            {!pushEnabled ? (
              <button
                onClick={handleEnablePush}
                className="ml-4 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
              >
                Enable
              </button>
            ) : (
              <div className="ml-4 flex items-center text-green-600">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Individual Preferences */}
        <div className="space-y-3">
          {preferences.map((pref) => (
            <div
              key={pref.id}
              className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{pref.icon}</span>
                <div>
                  <h4 className="font-medium text-[var(--text)]">
                    {pref.label}
                  </h4>
                  <p className="text-sm text-[var(--text-muted)]">
                    {pref.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() => togglePreference(pref.id)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 ${
                  pref.enabled ? "bg-violet-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    pref.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        {/* Info Box */}
        <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-900 dark:text-blue-200">
            💡 <strong>Tip:</strong> You can always change these preferences later in your settings.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 pt-8">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={submitting}
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
    </div>
  );
}
