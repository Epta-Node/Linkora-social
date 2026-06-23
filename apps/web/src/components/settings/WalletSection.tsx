'use client';

import { useWallet } from '@/hooks/useWallet';
import { useRouter } from 'next/navigation';

export function WalletSection() {
  const { address, network, disconnect } = useWallet();
  const router = useRouter();

  function handleDisconnect() {
    disconnect();
    router.push('/');
  }

  function truncateAddress(addr: string | null): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Wallet</h2>
      <p className="text-sm text-gray-600 mb-4">
        Manage your connected wallet and network settings.
      </p>

      <div className="space-y-4">
        {/* Connected Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Connected Address
          </label>
          <div className="flex items-center gap-3">
            <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-gray-700">
              {truncateAddress(address)}
            </code>
            <button
              onClick={() => address && navigator.clipboard.writeText(address)}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50"
              title="Copy full address"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Network Badge */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Network
          </label>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="text-sm font-medium text-blue-700">
              {network || 'Unknown'}
            </span>
          </div>
        </div>

        {/* Disconnect Button */}
        <div className="pt-2">
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 border border-gray-300"
          >
            Disconnect Wallet
          </button>
        </div>
      </div>
    </section>
  );
}
