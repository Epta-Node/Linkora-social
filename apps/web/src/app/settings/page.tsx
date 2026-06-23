'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useRouter } from 'next/navigation';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { WalletSection } from '@/components/settings/WalletSection';
import { DmKeySection } from '@/components/settings/DmKeySection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { GovernanceSection } from '@/components/settings/GovernanceSection';
import { DangerZoneSection } from '@/components/settings/DangerZoneSection';

export default function SettingsPage() {
  const { address, connected } = useWallet();
  const router = useRouter();

  if (!connected || !address) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <p className="text-gray-600">Connect your wallet to access settings.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      <div className="space-y-8">
        {/* Profile Section */}
        <ProfileSection address={address} />

        {/* Wallet Section */}
        <WalletSection />

        {/* DM Key Section */}
        <DmKeySection address={address} />

        {/* Notifications Section */}
        <NotificationsSection />

        {/* Governance Section */}
        <GovernanceSection address={address} />

        {/* Danger Zone Section */}
        <DangerZoneSection address={address} />
      </div>
    </div>
  );
}
