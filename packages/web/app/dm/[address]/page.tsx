'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../../../contexts/WalletContext';
import { useToast } from '../../../contexts/ToastContext';
import { DmService, type ConversationMessage } from '../../../../sdk/src/dm';
import { EmptyState, ErrorState } from '../../../components/states';

interface DirectMessagePageProps {
  params: {
    address: string;
  };
}

export default function DirectMessagePage({ params }: DirectMessagePageProps) {
  const router = useRouter();
  const { address } = params;
  const { wallet } = useWallet();
  const { showToast } = useToast();

  const [messages, setMessages] = useState<Array<ConversationMessage & { content: string }>>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmService, setDmService] = useState<DmService | null>(null);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);

  // Initialize DM service and check if keys need to be generated
  useEffect(() => {
    if (!wallet || !address) return;

    const initializeDm = async () => {
      try {
        setLoading(true);
        const service = new DmService(wallet, 'https://dm-relay.linkora.app');
        
        // Check if user has DM keys, if not prompt to generate
        const hasKeys = await service.hasLocalKeys();
        if (!hasKeys) {
          setShowKeyPrompt(true);
          setLoading(false);
          return;
        }
        
        setDmService(service);
        await loadMessages();
      } catch (err) {
        setError(`Failed to initialize messaging: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    initializeDm();
  }, [wallet, address, loadMessages]);

  const generateKeys = async () => {
    if (!wallet) return;

    try {
      setLoading(true);
      const service = new DmService(wallet, 'https://dm-relay.linkora.app');
      await service.generateAndPublishKeys();
      showToast('Encryption keys generated successfully', 'success');
      setShowKeyPrompt(false);
      setDmService(service);
      await loadMessages(service);
    } catch (err) {
      setError(`Failed to generate keys: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = useCallback(async () => {
    if (!dmService || !address) return;
    try {
      const msgs = await dmService.getMessages(address);
      setMessages(msgs);
    } catch (err) {
      setError(`Failed to load messages: ${err}`);
    }
  }, [dmService, address]);

  const sendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmService || !newMessage.trim() || !address) return;

    try {
      setLoading(true);
      await dmService.sendMessage(address, newMessage.trim());
      setNewMessage('');
      await loadMessages();
      showToast('Message sent', 'success');
    } catch (err) {
      setError(`Failed to send message: ${err}`);
      showToast('Failed to send message', 'error');
    } finally {
      setLoading(false);
    }
  }, [dmService, newMessage, address, loadMessages, showToast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const formEvent = { preventDefault: () => {} } as React.FormEvent;
      sendMessage(formEvent);
    }
  };

  if (showKeyPrompt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
          <div className="mb-4 text-center">
            <div className="mb-2 text-4xl">🔐</div>
            <h2 className="text-xl font-semibold text-gray-900">Enable Direct Messages</h2>
            <p className="mt-2 text-sm text-gray-600">
              To send encrypted messages, you need to generate encryption keys. This only needs to be done once and your keys are stored securely in your browser.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.back()}
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={generateKeys}
              disabled={loading}
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Keys'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          if (dmService) {
            loadMessages();
          }
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <button
          onClick={() => router.back()}
          className="text-blue-600 hover:text-blue-800"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold text-gray-900">Direct Message</h1>
        <span className="text-sm text-gray-500">{address.slice(0, 8)}...</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No messages yet"
            subtitle="Start a conversation by sending the first message"
          />
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isMyMessage = message.sender === wallet?.publicKey;
              return (
                <div
                  key={`${message.id}-${index}`}
                  className={`flex ${isMyMessage ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs rounded-lg px-4 py-2 lg:max-w-md ${
                      isMyMessage
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p
                      className={`mt-1 text-xs ${
                        isMyMessage ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      {new Date(message.timestamp * 1000).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="border-t border-gray-200 p-4">
        <form onSubmit={sendMessage} className="flex gap-3">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={loading || !dmService}
            maxLength={500}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            rows={2}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || loading || !dmService}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}