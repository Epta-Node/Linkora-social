'use client';

import { useWallet } from '@/contexts/WalletContext';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { isConnected, publicKey, connect, disconnect, isLoading } = useWallet();
  const router = useRouter();

  const handleConnect = async () => {
    await connect();
  };

  const goToFeed = () => {
    router.push('/feed');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-6 text-gray-900 dark:text-white">
            Welcome to Linkora
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
            A decentralized social platform built on Stellar
          </p>

          {!isConnected ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md mx-auto">
              <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
                Connect Your Wallet
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Connect your Stellar wallet to access your personalized feed and interact with the community.
              </p>
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Connecting...' : 'Connect Wallet'}
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md mx-auto">
              <div className="mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
                  Wallet Connected
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-all">
                  {publicKey?.slice(0, 8)}...{publicKey?.slice(-8)}
                </p>
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={goToFeed}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                >
                  View Your Feed
                </button>
                <button
                  onClick={disconnect}
                  className="w-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
              <div className="text-3xl mb-3">👥</div>
              <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-white">Follow</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Connect with creators and build your social graph on-chain
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
              <div className="text-3xl mb-3">📝</div>
              <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-white">Post</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Share your thoughts with the community
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
              <div className="text-3xl mb-3">💰</div>
              <h3 className="font-semibold text-lg mb-2 text-gray-900 dark:text-white">Tip</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                Support creators with token tips
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
