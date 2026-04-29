'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import freighterApi from '@stellar/freighter-api';

interface WalletContextType {
  isConnected: boolean;
  publicKey: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  isLoading: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const connect = async () => {
    setIsLoading(true);
    try {
      const { address } = await freighterApi.getAddress();
      if (address) {
        setPublicKey(address);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = () => {
    setPublicKey(null);
    setIsConnected(false);
  };

  useEffect(() => {
    // Check if wallet is already connected on mount
    const checkConnection = async () => {
      try {
        const { isConnected: connected } = await freighterApi.isConnected();
        if (connected) {
          await connect();
        }
      } catch (error) {
        console.error('Failed to check wallet connection:', error);
      }
    };
    checkConnection();
  }, []);

  return (
    <WalletContext.Provider value={{ isConnected, publicKey, connect, disconnect, isLoading }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
