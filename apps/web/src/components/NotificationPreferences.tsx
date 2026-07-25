import React, { useState, useEffect } from 'react';
import { registerServiceWorkerAndSubscribe, unsubscribeFromPush, savePreferencesToBackend } from '../services/pushNotification';

interface PreferencesState {
  newFollowers: boolean;
  likes: boolean;
  commentsReplies: boolean;
  poolTipReceived: boolean;
  governanceUpdates: boolean;
  masterPushEnabled: boolean;
}

export const NotificationPreferences: React.FC = () => {
  const [preferences, setPreferences] = useState<PreferencesState>({
    newFollowers: true,
    likes: true,
    commentsReplies: true,
    poolTipReceived: true,
    governanceUpdates: true,
    masterPushEnabled: false
  });
  
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Hydrate local preferences state from localStorage or mock initial fetch on mount
  useEffect(() => {
    const savedPrefs = localStorage.getItem('linkora_notification_prefs');
    if (savedPrefs) {
      setPreferences(JSON.parse(savedPrefs));
    }
    
    // Sync UI with native browser permission state
    if ('Notification' in window) {
      if (Notification.permission !== 'granted') {
        setPreferences(prev => ({ ...prev, masterPushEnabled: false }));
      }
    }
  }, []);

  const handleToggle = (key: keyof PreferencesState) => {
    setPreferences(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleMasterPushToggle = async () => {
    try {
      setLoading(true);
      setMessage(null);

      if (!preferences.masterPushEnabled) {
        // User wants to enable browser notifications
        if ('Notification' in window) {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            setMessage({ type: 'error', text: 'Permission for notifications was denied by the browser.' });
            setLoading(false);
            return;
          }
        }
        
        // Register SW and fetch the subscription Object
        await registerServiceWorkerAndSubscribe();
        setPreferences(prev => ({ ...prev, masterPushEnabled: true }));
      } else {
        // User wants to disable browser notifications completely
        await unsubscribeFromPush();
        setPreferences(prev => ({ ...prev, masterPushEnabled: false }));
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Error configuring browser Push subscription.' });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setLoading(true);
    setMessage(null);
    try {
      let subscription = null;
      if (preferences.masterPushEnabled) {
        subscription = await registerServiceWorkerAndSubscribe();
      }

      // 1. Persist to local state cache
      localStorage.setItem('linkora_notification_prefs', JSON.stringify(preferences));

      // 2. Transmit preferences state to backend database records
      await savePreferencesToBackend(preferences, subscription);

      setMessage({ type: 'success', text: 'Notification preferences updated successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to synchronize settings with server database.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mt-6 border border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Push Notification Preferences</h2>
      
      {message && (
        <div className={`p-3 rounded mb-4 text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message.text}
        </div>
      )}

      {/* Browser Native Push Permission Activation */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <label className="font-semibold text-gray-800 dark:text-gray-200">Enable Browser Push Notifications</label>
          <p className="text-xs text-gray-500">Required to receive native alerts on your operating system</p>
        </div>
        <input 
          type="checkbox" 
          className="w-5 h-5 accent-blue-600 cursor-pointer"
          checked={preferences.masterPushEnabled} 
          onChange={handleMasterPushToggle}
          disabled={loading}
        />
      </div>

      {/* Individual Preference Controls */}
      <div className={`space-y-4 ${!preferences.masterPushEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">New Followers</span>
          <input 
            type="checkbox" 
            className="w-4 h-4 accent-blue-500 cursor-pointer"
            checked={preferences.newFollowers} 
            onChange={() => handleToggle('newFollowers')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">Likes on your posts</span>
          <input 
            type="checkbox" 
            className="w-4 h-4 accent-blue-500 cursor-pointer"
            checked={preferences.likes} 
            onChange={() => handleToggle('likes')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">Comments / Replies</span>
          <input 
            type="checkbox" 
            className="w-4 h-4 accent-blue-500 cursor-pointer"
            checked={preferences.commentsReplies} 
            onChange={() => handleToggle('commentsReplies')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">Pool / Tip received</span>
          <input 
            type="checkbox" 
            className="w-4 h-4 accent-blue-500 cursor-pointer"
            checked={preferences.poolTipReceived} 
            onChange={() => handleToggle('poolTipReceived')}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">Governance proposal updates</span>
          <input 
            type="checkbox" 
            className="w-4 h-4 accent-blue-500 cursor-pointer"
            checked={preferences.governanceUpdates} 
            onChange={() => handleToggle('governanceUpdates')}
          />
        </div>

      </div>

      <button
        onClick={saveSettings}
        disabled={loading}
        className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition duration-200 disabled:bg-gray-400"
      >
        {loading ? 'Saving Preferences...' : 'Save Preferences'}
      </button>
    </div>
  );
};