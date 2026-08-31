import React from 'react';

// 1. FEED PAGE: Post Cards Skeleton
export const PostCardSkeleton: React.FC = () => (
  <div className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4 animate-pulse">
    <div className="flex items-center space-x-3 mb-4">
      <div className="w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-1/6" />
      </div>
    </div>
    <div className="space-y-2 mb-4">
      <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full" />
      <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-11/12" />
      <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-2/3" />
    </div>
    <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-lg mb-4" />
    <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-700">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12" />
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12" />
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12" />
    </div>
  </div>
);

// 2. PROFILE PAGE: Avatar, Stats, Posts Grid Skeleton
export const ProfileSkeleton: React.FC = () => (
  <div className="w-full max-w-4xl mx-auto p-4 animate-pulse">
    {/* Banner placeholder */}
    <div className="w-full h-32 md:h-48 bg-gray-300 dark:bg-gray-700 rounded-xl mb-16" />
    
    {/* Avatar & Action details */}
    <div className="px-4 relative mb-6">
      <div className="absolute -top-16 left-4 w-24 h-24 md:w-32 md:h-32 bg-gray-200 dark:bg-gray-600 rounded-full border-4 border-white dark:border-gray-900" />
      <div className="flex justify-end pt-4">
        <div className="h-9 bg-gray-300 dark:bg-gray-700 rounded-full w-28" />
      </div>
    </div>

    {/* Username and Stats Layout */}
    <div className="px-4 space-y-4 mb-8">
      <div className="space-y-2">
        <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/4" />
      </div>
      <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-2/3" />
      <div className="flex space-x-6 pt-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-16" />
      </div>
    </div>

    {/* Grid of Posts */}
    <div className="grid grid-cols-3 gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="aspect-square bg-gray-200 dark:bg-gray-700 rounded" />
      ))}
    </div>
  </div>
);

// 3. EXPLORE PAGE: Search Results Skeleton
export const ExploreSkeleton: React.FC = () => (
  <div className="w-full max-w-2xl mx-auto p-4 space-y-4 animate-pulse">
    <div className="h-10 bg-gray-300 dark:bg-gray-700 rounded-lg w-full mb-6" /> {/* Search bar */}
    {[...Array(4)].map((_, i) => (
      <div key={i} className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg">
        <div className="flex items-center space-x-3 flex-1">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/3" />
            <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-1/2" />
          </div>
        </div>
        <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-20" />
      </div>
    ))}
  </div>
);

// 4. DM CONVERSATIONS: Chat List Skeleton
export const DMSkeleton: React.FC = () => (
  <div className="w-full max-w-md mx-auto divide-y divide-gray-100 dark:divide-gray-800 animate-pulse">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex items-center space-x-3 py-4 px-3">
        <div className="w-12 h-12 bg-gray-300 dark:bg-gray-700 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex justify-between items-center">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/3" />
            <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-12" />
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-3/4 truncate" />
        </div>
      </div>
    ))}
  </div>
);

// 5. NOTIFICATIONS: Alert Feed List Skeleton
export const NotificationSkeleton: React.FC = () => (
  <div className="w-full max-w-2xl mx-auto space-y-2 animate-pulse">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex items-center space-x-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
        <div className="w-5 h-5 bg-gray-300 dark:bg-gray-700 rounded-full flex-shrink-0" /> {/* Type Icon */}
        <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0" /> {/* User avatar */}
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-2/3" />
          <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-16" />
        </div>
      </div>
    ))}
  </div>
);