'use client';

import { useState, useEffect } from 'react';

interface NotificationSettings {
  browserPushEnabled: boolean;
  newFollowers: boolean;
  newLikes: boolean;
  newComments: boolean;
  directMessages: boolean;
  poolActivity: boolean;
  governanceUpdates: boolean;
}

export function NotificationsSection() {
  const [settings, setSettings] = useState<NotificationSettings>({
    browserPushEnabled: false,
    newFollowers: true,
    newLikes: true,
    newComments: true,
    directMessages: true,
    poolActivity: true,
    governanceUpdates: true,
  });
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    // Check if browser supports push notifications
    if ('Notification' in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    // Load saved settings from localStorage
    const saved = localStorage.getItem('notification_settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to parse notification settings:', error);
      }
    }
  }, []);

  async function handleTogglePush() {
    if (!pushSupported) return;

    if (pushPermission === 'granted') {
      // Disable push notifications
      setSettings((prev) => ({ ...prev, browserPushEnabled: false }));
      setPushPermission('default');
    } else {
      // Request permission
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission === 'granted') {
        setSettings((prev) => ({ ...prev, browserPushEnabled: true }));
      }
    }
  }

  function handleToggleSetting(key: keyof NotificationSettings) {
    setSettings((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem('notification_settings', JSON.stringify(updated));
      return updated;
    });
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Notifications</h2>
      <p className="text-sm text-gray-600 mb-4">
        Configure which notifications you want to receive.
      </p>

      <div className="space-y-4">
        {/* Browser Push Notifications */}
        {pushSupported && (
          <div className="pb-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Browser Push Notifications</p>
                <p className="text-xs text-gray-500 mt-1">
                  Receive notifications even when Linkora is not open
                </p>
              </div>
              <button
                onClick={handleTogglePush}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.browserPushEnabled ? 'bg-violet-600' : 'bg-gray-200'
                }`}
                role="switch"
                aria-checked={settings.browserPushEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.browserPushEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Notification Types */}
        <div className="space-y-3">
          <NotificationToggle
            label="New Followers"
            description="When someone follows you"
            checked={settings.newFollowers}
            onChange={() => handleToggleSetting('newFollowers')}
          />
          <NotificationToggle
            label="New Likes"
            description="When someone likes your post"
            checked={settings.newLikes}
            onChange={() => handleToggleSetting('newLikes')}
          />
          <NotificationToggle
            label="New Comments"
            description="When someone comments on your post"
            checked={settings.newComments}
            onChange={() => handleToggleSetting('newComments')}
          />
          <NotificationToggle
            label="Direct Messages"
            description="When you receive a new DM"
            checked={settings.directMessages}
            onChange={() => handleToggleSetting('directMessages')}
          />
          <NotificationToggle
            label="Pool Activity"
            description="When there's activity in your pools"
            checked={settings.poolActivity}
            onChange={() => handleToggleSetting('poolActivity')}
          />
          <NotificationToggle
            label="Governance Updates"
            description="When there are new proposals or votes"
            checked={settings.governanceUpdates}
            onChange={() => handleToggleSetting('governanceUpdates')}
          />
        </div>
      </div>
    </section>
  );
}

interface NotificationToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function NotificationToggle({ label, description, checked, onChange }: NotificationToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <button
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-violet-600' : 'bg-gray-200'
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
