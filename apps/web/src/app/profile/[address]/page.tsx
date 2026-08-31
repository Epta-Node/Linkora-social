'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

/**
 * Converts a target ledger sequence number into a human-readable relative time string
 * assuming approximately 5 seconds per Stellar ledger block.
 *
 * @param ledger - The target ledger sequence number.
 * @param currentLedger - The current sequence number of the latest ledger.
 * @returns A formatted relative time string (e.g. "just now", "15s ago", "2m ago", "1h ago", "3d ago").
 */
export function ledgerToRelative(ledger: number, currentLedger: number = 0): string {
  if (!ledger || ledger <= 0) return 'just now';
  if (!currentLedger || currentLedger <= ledger) return 'just now';

  const diffLedgers = currentLedger - ledger;
  const seconds = diffLedgers * 5;

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface ProfilePost {
  id: string;
  author: string;
  content: string;
  ledger: number;
}

interface ProfileData {
  address: string;
  username: string;
  posts: ProfilePost[];
  currentLedger: number;
}

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;

    setProfile({
      address,
      username: `user_${address.slice(0, 6)}`,
      currentLedger: 1000000,
      posts: [
        {
          id: '1',
          author: address,
          content: 'Hello Linkora! Exploring decentralized social features.',
          ledger: 999980,
        },
        {
          id: '2',
          author: address,
          content: 'Stellar Soroban contracts power creator economics.',
          ledger: 992800,
        },
      ],
    });
    setLoading(false);
  }, [address]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center text-gray-600">
        Loading profile...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto px-4 py-8 text-center text-gray-600">
        Profile not found
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">@{profile.username}</h1>
        <p className="text-sm text-gray-500 font-mono mt-1">{profile.address}</p>
      </div>

      <h2 className="text-xl font-semibold mb-4 text-gray-900">Activity & Posts</h2>
      <div className="space-y-4">
        {profile.posts.map((post) => (
          <div key={post.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">@{profile.username}</span>
              <span className="text-xs text-gray-500" title={`Ledger #${post.ledger}`}>
                {ledgerToRelative(post.ledger, profile.currentLedger)}
              </span>
            </div>
            <p className="text-gray-900">{post.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
