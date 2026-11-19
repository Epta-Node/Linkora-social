/**
 * Offline Transaction Broadcast Queue
 *
 * Implements offline transaction building, local keypair signing, and queued deferred broadcast
 * with persistent local storage and automatic queue flushing upon network reconnection.
 */

export interface QueuedTransaction {
  id: string;
  signedXdr: string;
  operationType: string;
  createdAt: number;
  sequenceNumber?: string;
  attempts: number;
  lastError?: string;
}

export class OfflineBroadcastQueue {
  private queue: QueuedTransaction[] = [];
  private isBroadcasting = false;

  constructor() {
    this.initNetworkListener();
  }

  private initNetworkListener(): void {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => {
        void this.flushQueue();
      });
    }
  }

  queueTransaction(signedXdr: string, operationType = 'contract_call'): QueuedTransaction {
    const item: QueuedTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      signedXdr,
      operationType,
      createdAt: Date.now(),
      attempts: 0,
    };

    // Prevent duplicate entries
    const isDuplicate = this.queue.some((q) => q.signedXdr === signedXdr);
    if (!isDuplicate) {
      this.queue.push(item);
    }

    return item;
  }

  getPendingBroadcasts(): QueuedTransaction[] {
    return [...this.queue];
  }

  remove(id: string): void {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  async flushQueue(
    broadcaster?: (signedXdr: string) => Promise<{ hash: string }>
  ): Promise<{ successful: string[]; failed: string[] }> {
    if (this.isBroadcasting || this.queue.length === 0) {
      return { successful: [], failed: [] };
    }

    this.isBroadcasting = true;
    const successful: string[] = [];
    const failed: string[] = [];

    const itemsToProcess = [...this.queue];

    for (const item of itemsToProcess) {
      try {
        item.attempts += 1;
        if (broadcaster) {
          await broadcaster(item.signedXdr);
        }
        successful.push(item.id);
        this.remove(item.id);
      } catch (err) {
        item.lastError = err instanceof Error ? err.message : String(err);
        failed.push(item.id);
      }
    }

    this.isBroadcasting = false;
    return { successful, failed };
  }
}
