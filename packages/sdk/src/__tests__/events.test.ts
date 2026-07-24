/**
 * events.test.ts
 *
 * Test suite for the Linkora SDK event subscription layer covering:
 *   1. parseContractEvent – typed decoding of all contract event types
 *   2. LinkoraEventSubscriber – subscribe / start / stop lifecycle
 *   3. Cursor persistence – reload resumes without duplicates
 *   4. Reconnection with exponential backoff after RPC 503 errors
 *   5. CursorStore backends (Memory, LocalStorage, File)
 */

// ---------------------------------------------------------------------------
// Mock @stellar/stellar-base
// Our test fixtures encode values as { __native: <value> } serialised to base64.
// The mock scValToNative simply unwraps that envelope, and fromXDR deserialises it.
// ---------------------------------------------------------------------------
jest.mock("@stellar/stellar-base", () => ({
  scValToNative: (scv: unknown) => {
    if (scv && typeof scv === "object" && "__native" in (scv as object)) {
      return (scv as { __native: unknown }).__native;
    }
    return scv;
  },
  xdr: {
    ScVal: {
      fromXDR: (encoded: string, _fmt: string) => {
        try {
          return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        } catch {
          return { __native: encoded };
        }
      },
    },
  },
}));

import { parseContractEvent, SorobanEvent, FollowEvent, LinkoraEvent } from "../events/types";
import { LinkoraEventSubscriber, LinkoraEventSubscriberConfig } from "../events/subscriber";
import {
  MemoryCursorStore,
  LocalStorageCursorStore,
  FileCursorStore,
  SecureStoreCursorStore,
} from "../events/cursor";

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

/** Encode a JS value as a base64 XDR stub understood by the mock. */
function enc(value: unknown): string {
  return Buffer.from(JSON.stringify({ __native: value })).toString("base64");
}

/**
 * Build a raw Soroban event.
 *
 * The parser's `payloadFrom()` merges *object-typed* topics into the payload.
 * For events whose fields come from topics (addresses, ids), we pass them as
 * an object topic so the parser can pick them up — exactly as a real Soroban
 * event would expose them after XDR decoding.
 *
 * `topics` is the array of already-encoded topic strings.
 * `data`   is an optional already-encoded data string.
 */
function rawEvent(
  overrides: Partial<SorobanEvent> & { topics: string[]; data?: string }
): SorobanEvent {
  return {
    id: "0000001",
    pagingToken: "0000001",
    ledger: 100,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    contractId: "CONTRACT_ADDR",
    txHash: "TXHASH",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. parseContractEvent – typed decoding of all event types
// ---------------------------------------------------------------------------

describe("parseContractEvent", () => {
  // Events whose all payload fields are supplied via `data` so the parser
  // can look them up without relying on positional topic extraction.

  it("decodes FollowEvent", () => {
    const raw = rawEvent({
      topics: [enc("follow")],
      data: enc({ follower: "GFOLLOWER", followee: "GFOLLOWEE" }),
    });
    const evt = parseContractEvent(raw) as FollowEvent;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("follow");
    expect(evt.follower).toBe("GFOLLOWER");
    expect(evt.followee).toBe("GFOLLOWEE");
  });

  it("decodes PostCreatedEvent", () => {
    const raw = rawEvent({
      topics: [enc("post_created")],
      data: enc({ id: 42, author: "GAUTHOR" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "post_created" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("post_created");
    expect(evt.id).toBe(42);
    expect(evt.author).toBe("GAUTHOR");
  });

  it("decodes PostDeletedEvent", () => {
    const raw = rawEvent({
      topics: [enc("post_deleted")],
      data: enc({ post_id: 7, author: "GAUTHOR" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "post_deleted" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("post_deleted");
    expect(evt.post_id).toBe(7);
    expect(evt.author).toBe("GAUTHOR");
  });

  it("decodes LikeEvent", () => {
    const raw = rawEvent({
      topics: [enc("like")],
      data: enc({ user: "GUSER", post_id: 5 }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "like" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("like");
    expect(evt.user).toBe("GUSER");
    expect(evt.post_id).toBe(5);
  });

  it("decodes UnfollowEvent", () => {
    const raw = rawEvent({
      topics: [enc("unfollow")],
      data: enc({ follower: "GFOLLOWER", followee: "GFOLLOWEE" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "unfollow" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("unfollow");
    expect(evt.follower).toBe("GFOLLOWER");
    expect(evt.followee).toBe("GFOLLOWEE");
  });

  it("decodes TipEvent with bigint amounts", () => {
    const raw = rawEvent({
      topics: [enc("tip")],
      data: enc({ tipper: "GTIPPER", post_id: 3, amount: "5000000", fee: "250000" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "tip" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("tip");
    expect(evt.tipper).toBe("GTIPPER");
    expect(evt.post_id).toBe(3);
    expect(evt.amount).toBe(5000000n);
    expect(evt.fee).toBe(250000n);
  });

  it("decodes PoolDepositEvent", () => {
    const raw = rawEvent({
      topics: [enc("pool_deposit")],
      data: enc({ depositor: "GDEPOSITOR", pool_id: "rewards", amount: "10000" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "pool_deposit" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("pool_deposit");
    expect(evt.depositor).toBe("GDEPOSITOR");
    expect(evt.pool_id).toBe("rewards");
    expect(evt.amount).toBe(10000n);
  });

  it("decodes PoolWithdrawEvent", () => {
    const raw = rawEvent({
      topics: [enc("pool_withdraw")],
      data: enc({ recipient: "GRECIPIENT", pool_id: "rewards", amount: "500" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "pool_withdraw" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("pool_withdraw");
    expect(evt.recipient).toBe("GRECIPIENT");
    expect(evt.pool_id).toBe("rewards");
    expect(evt.amount).toBe(500n);
  });

  it("decodes GovProposalCreatedEvent", () => {
    const raw = rawEvent({
      topics: [enc("gov_proposal_created")],
      data: enc({ proposal_id: 1, proposer: "GPROPOSER", parameter: "FeeBps", new_value: 200 }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "gov_proposal_created" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("gov_proposal_created");
    expect(evt.proposal_id).toBe(1);
    expect(evt.proposer).toBe("GPROPOSER");
    expect(evt.parameter).toBe("FeeBps");
    expect(evt.new_value).toBe(200);
  });

  it("decodes GovVoteEvent", () => {
    const raw = rawEvent({
      topics: [enc("gov_vote")],
      data: enc({ proposal_id: 1, voter: "GVOTER", support: true }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "gov_vote" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("gov_vote");
    expect(evt.proposal_id).toBe(1);
    expect(evt.voter).toBe("GVOTER");
    expect(evt.support).toBe(true);
  });

  it("decodes GovProposalExecutedEvent", () => {
    const raw = rawEvent({
      topics: [enc("gov_proposal_executed")],
      data: enc({ proposal_id: 1, parameter: "FeeBps", new_value: 200 }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "gov_proposal_executed" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("gov_proposal_executed");
    expect(evt.proposal_id).toBe(1);
    expect(evt.parameter).toBe("FeeBps");
    expect(evt.new_value).toBe(200);
  });

  it("decodes DmKeyPublishedEvent", () => {
    const raw = rawEvent({
      topics: [enc("dm_key_published")],
      data: enc({ user: "GUSER", key: "BASE64_PUBKEY==" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "dm_key_published" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("dm_key_published");
    expect(evt.user).toBe("GUSER");
    expect(evt.key).toBe("BASE64_PUBKEY==");
  });

  it("decodes EmergencyBypassEvent", () => {
    const raw = rawEvent({
      topics: [enc("emergency_bypass")],
      data: enc({ action: "pause" }),
    });
    const evt = parseContractEvent(raw) as Extract<LinkoraEvent, { type: "emergency_bypass" }>;
    expect(evt).not.toBeNull();
    expect(evt.type).toBe("emergency_bypass");
    expect(evt.action).toBe("pause");
  });

  it("decodes analytics and moderation events added after the initial subscriber", () => {
    const attestation = parseContractEvent(
      rawEvent({
        topics: [enc("AttestationVerifiedEvent")],
        data: enc({
          oracle_name: "oracle",
          report_hash: "hash",
          creator: "GCREATOR",
          window_start: 10,
          window_end: 20,
        }),
      })
    ) as Extract<LinkoraEvent, { type: "attestation_verified" }>;

    const report = parseContractEvent(
      rawEvent({
        topics: [enc("PostReportedEvent")],
        data: enc({ post_id: 12, reporter: "GREPORTER", stake_amount: "7000000" }),
      })
    ) as Extract<LinkoraEvent, { type: "post_reported" }>;

    expect(attestation.type).toBe("attestation_verified");
    expect(attestation.oracle_name).toBe("oracle");
    expect(attestation.window_end).toBe(20);
    expect(report.type).toBe("post_reported");
    expect(report.stake_amount).toBe(7000000n);
  });

  it("recognizes every current contract event discriminator", () => {
    const fixtures: Array<[string, Record<string, unknown>]> = [
      [
        "RentPaidEvent",
        { user: "GU", payer: "GP", token: "GT", amount: "1", extended_to_ledger: 2 },
      ],
      ["ProfileSetEvent", { user: "GU", username: "alice" }],
      ["FollowEvent", { follower: "GA", followee: "GB" }],
      ["UnfollowEvent", { follower: "GA", followee: "GB" }],
      ["BlockEvent", { blocker: "GA", blocked: "GB" }],
      ["UnblockEvent", { blocker: "GA", blocked: "GB" }],
      ["PostCreatedEvent", { id: 1, author: "GA" }],
      ["TipEvent", { tipper: "GA", post_id: 1, amount: "2", fee: "1" }],
      ["PoolDepositEvent", { depositor: "GA", pool_id: "pool", amount: "3" }],
      ["PoolWithdrawEvent", { recipient: "GA", pool_id: "pool", amount: "3" }],
      ["PoolCreatedEvent", { pool_id: "pool", token: "GT", admins: ["GA"], threshold: 1 }],
      ["LikePostEvent", { user: "GA", post_id: 1 }],
      ["ContractUpgraded", { new_wasm_hash: "hash" }],
      ["PostDeleted", { post_id: 1, author: "GA" }],
      [
        "ProposalCreatedEvent",
        { pool_id: "pool", proposal_id: 1, proposer: "GA", amount: "4", recipient: "GB" },
      ],
      ["ProposalSignedEvent", { pool_id: "pool", proposal_id: 1, signer: "GA" }],
      ["ProposalExecutedEvent", { pool_id: "pool", proposal_id: 1, amount: "4", recipient: "GB" }],
      ["PoolAdminAddedEvent", { pool_id: "pool", new_admin: "GA" }],
      ["PoolAdminRemovedEvent", { pool_id: "pool", admin: "GA" }],
      ["PoolThresholdUpdatedEvent", { pool_id: "pool", old_threshold: 1, new_threshold: 2 }],
      ["DmKeyPublishedEvent", { user: "GA", public_key: "PUB" }],
      ["CredentialRootUpdatedEvent", { user: "GA", root: "ROOT" }],
      ["CredentialVerifiedEvent", { user: "GA", nullifier: "NULL" }],
      ["FeeUpdatedEvent", { name: "fee", old_fee_bps: 1, new_fee_bps: 2 }],
      ["TreasuryUpdatedEvent", { name: "treasury", old_treasury: "GA", new_treasury: "GB" }],
      [
        "GovProposalCreatedEvent",
        { proposal_id: 1, proposer: "GA", parameter: "FeeBps", new_value: 2 },
      ],
      ["GovVoteEvent", { proposal_id: 1, voter: "GA", support: true }],
      ["GovProposalExecutedEvent", { proposal_id: 1, parameter: "FeeBps", new_value: 2 }],
      ["GovProposalVetoedEvent", { proposal_id: 1 }],
      ["EmergencyBypassEvent", { action: "pause" }],
      [
        "AttestationVerifiedEvent",
        {
          oracle_name: "oracle",
          report_hash: "hash",
          creator: "GA",
          window_start: 1,
          window_end: 2,
        },
      ],
      ["PostReportedEvent", { post_id: 1, reporter: "GA", stake_amount: "5" }],
      ["PostRemovedByModerationEvent", { post_id: 1, reporter: "GA" }],
      ["ReportDismissedEvent", { post_id: 1, reporter: "GA" }],
    ];

    for (const [name, data] of fixtures) {
      expect(parseContractEvent(rawEvent({ topics: [enc(name)], data: enc(data) }))).not.toBeNull();
    }
  });

  // ── Acceptance criterion: null for unknown / malformed events ────────────

  it("returns null for an unknown event type without throwing", () => {
    const raw = rawEvent({ topics: [enc("unknown_future_event_v9")] });
    expect(() => parseContractEvent(raw)).not.toThrow();
    expect(parseContractEvent(raw)).toBeNull();
  });

  it("returns null when topics array is missing", () => {
    const raw: SorobanEvent = { id: "x", contractId: "C" };
    expect(parseContractEvent(raw)).toBeNull();
  });

  it("returns null for malformed XDR without throwing", () => {
    const raw = rawEvent({ topics: ["!!!not_valid_base64!!!"] });
    expect(() => parseContractEvent(raw)).not.toThrow();
    expect(parseContractEvent(raw)).toBeNull();
  });

  it("populates LinkoraEventMeta on all events", () => {
    const raw = rawEvent({
      id: "evt-meta-99",
      pagingToken: "paging-99",
      ledger: 999,
      ledgerClosedAt: "2024-06-01T12:00:00Z",
      txHash: "TXHASH99",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });
    const evt = parseContractEvent(raw)!;
    expect(evt.meta.id).toBe("evt-meta-99");
    expect(evt.meta.pagingToken).toBe("paging-99");
    expect(evt.meta.ledger).toBe(999);
    expect(evt.meta.txHash).toBe("TXHASH99");
    expect(evt.meta.raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Shared subscriber test helpers
// ---------------------------------------------------------------------------

type SubscriberPrivate = {
  stopRequested: boolean;
  pollIntervalMs: number;
  fetchEvents(): Promise<{ events: SorobanEvent[] }>;
  processBatch(events: SorobanEvent[]): Promise<void>;
  backoff(): void;
  updatePollInterval(count: number): void;
  loop(): Promise<void>;
};

function priv(sub: LinkoraEventSubscriber): SubscriberPrivate {
  return sub as unknown as SubscriberPrivate;
}

/** Drive exactly n poll cycles (without sleeping between them). */
async function driveCycles(sub: LinkoraEventSubscriber, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (priv(sub).stopRequested) break;
    try {
      const result = await priv(sub).fetchEvents();
      await priv(sub).processBatch(result.events);
      priv(sub).updatePollInterval(result.events.length);
    } catch {
      priv(sub).backoff();
    }
  }
}

function makeSub(
  extra?: Partial<LinkoraEventSubscriberConfig>,
  cursorStore?: MemoryCursorStore
): LinkoraEventSubscriber {
  return new LinkoraEventSubscriber({
    rpcUrl: "https://rpc.example.com",
    contractId: "CCONTRACT000",
    cursorStore: cursorStore ?? new MemoryCursorStore(),
    startLedger: 0,
    minPollIntervalMs: 100,
    maxPollIntervalMs: 5000,
    ...extra,
  });
}

function rpcResponses(pages: SorobanEvent[][]): jest.Mock {
  const queue = [...pages];
  return jest.fn().mockImplementation(async () => {
    const events = queue.shift() ?? [];
    return {
      ok: true,
      json: async () => ({ result: { events, latestLedger: 100 } }),
    };
  });
}

// ---------------------------------------------------------------------------
// 2. LinkoraEventSubscriber – subscribe / start / stop lifecycle
// ---------------------------------------------------------------------------

describe("LinkoraEventSubscriber", () => {
  let savedFetch: typeof globalThis.fetch;
  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  // ── Acceptance criterion: subscribe to FollowEvent; verify handler fires ──

  it("fires FollowEvent handler with correct follower / followee fields", async () => {
    const followEvent = rawEvent({
      id: "follow-001",
      pagingToken: "cursor-001",
      topics: [enc("follow")],
      data: enc({ follower: "GFOLLOWER", followee: "GFOLLOWEE" }),
    });
    globalThis.fetch = rpcResponses([[followEvent]]) as unknown as typeof fetch;

    const sub = makeSub();
    const received: FollowEvent[] = [];
    sub.subscribe({
      follow: (e) => {
        received.push(e);
      },
    });

    await driveCycles(sub, 1);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("follow");
    expect(received[0].follower).toBe("GFOLLOWER");
    expect(received[0].followee).toBe("GFOLLOWEE");
    expect(received[0].meta.id).toBe("follow-001");
  });

  it("does not fire handler for unregistered event types", async () => {
    const tipEvent = rawEvent({
      id: "tip-001",
      pagingToken: "cursor-tip",
      topics: [enc("tip")],
      data: enc({ tipper: "GT", post_id: 1, amount: "100", fee: "5" }),
    });
    globalThis.fetch = rpcResponses([[tipEvent]]) as unknown as typeof fetch;

    const sub = makeSub();
    const followHandler = jest.fn();
    sub.subscribe({ follow: followHandler });

    await driveCycles(sub, 1);
    expect(followHandler).not.toHaveBeenCalled();
  });

  it("unsubscribe callback prevents handler from being called", async () => {
    const event = rawEvent({
      id: "f-002",
      pagingToken: "cursor-002",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });
    globalThis.fetch = rpcResponses([[event]]) as unknown as typeof fetch;

    const sub = makeSub();
    const handler = jest.fn();
    const unsubscribe = sub.subscribe({ follow: handler });
    unsubscribe();

    await driveCycles(sub, 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("start() is idempotent – second call is a no-op", async () => {
    globalThis.fetch = rpcResponses([[]]) as unknown as typeof fetch;
    const sub = makeSub();
    priv(sub).loop = async () => {};

    await sub.start();
    await sub.start(); // must not throw or double-start
    await sub.stop();
  });

  it("multiple handlers coexist for different event types", async () => {
    const followEvent = rawEvent({
      id: "f-m",
      pagingToken: "c-f",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });
    const tipEvent = rawEvent({
      id: "t-m",
      pagingToken: "c-t",
      topics: [enc("tip")],
      data: enc({ tipper: "GT", post_id: 1, amount: "100", fee: "5" }),
    });
    globalThis.fetch = rpcResponses([[followEvent, tipEvent]]) as unknown as typeof fetch;

    const sub = makeSub();
    const followHandler = jest.fn();
    const tipHandler = jest.fn();
    sub.subscribe({ follow: followHandler, tip: tipHandler });

    await driveCycles(sub, 1);
    expect(followHandler).toHaveBeenCalledTimes(1);
    expect(tipHandler).toHaveBeenCalledTimes(1);
  });

  it("dispatches governance, analytics, moderation, and DM handlers", async () => {
    const events = [
      rawEvent({
        id: "gov-proposal",
        pagingToken: "c1",
        topics: [enc("GovProposalCreatedEvent")],
        data: enc({ proposal_id: 1, proposer: "GP", parameter: "FeeBps", new_value: 100 }),
      }),
      rawEvent({
        id: "gov-vote",
        pagingToken: "c2",
        topics: [enc("GovVoteEvent")],
        data: enc({ proposal_id: 1, voter: "GV", support: true }),
      }),
      rawEvent({
        id: "attestation",
        pagingToken: "c3",
        topics: [enc("AttestationVerifiedEvent")],
        data: enc({
          oracle_name: "oracle",
          report_hash: "hash",
          creator: "GC",
          window_start: 1,
          window_end: 2,
        }),
      }),
      rawEvent({
        id: "reported",
        pagingToken: "c4",
        topics: [enc("PostReportedEvent")],
        data: enc({ post_id: 2, reporter: "GR", stake_amount: "10" }),
      }),
      rawEvent({
        id: "dm-key",
        pagingToken: "c5",
        topics: [enc("DmKeyPublishedEvent")],
        data: enc({ user: "GD", public_key: "PUB" }),
      }),
    ];
    globalThis.fetch = rpcResponses([events]) as unknown as typeof fetch;

    const sub = makeSub();
    const handlers = {
      gov_proposal_created: jest.fn(),
      gov_vote: jest.fn(),
      attestation_verified: jest.fn(),
      post_reported: jest.fn(),
      dm_key_published: jest.fn(),
    };
    sub.subscribe(handlers);

    await driveCycles(sub, 1);

    expect(handlers.gov_proposal_created).toHaveBeenCalledTimes(1);
    expect(handlers.gov_vote).toHaveBeenCalledTimes(1);
    expect(handlers.attestation_verified).toHaveBeenCalledTimes(1);
    expect(handlers.post_reported).toHaveBeenCalledTimes(1);
    expect(handlers.dm_key_published).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Cursor persistence – reload resumes without duplicates
// ---------------------------------------------------------------------------

describe("Cursor persistence – no duplicate events on reload", () => {
  let savedFetch: typeof globalThis.fetch;
  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  it("persists cursor after processing each event in a batch", async () => {
    const event = rawEvent({
      id: "evt-p-1",
      pagingToken: "cursor-abc",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });
    globalThis.fetch = rpcResponses([[event]]) as unknown as typeof fetch;

    const cursorStore = new MemoryCursorStore();
    const sub = makeSub({}, cursorStore);
    sub.subscribe({ follow: () => {} });

    await driveCycles(sub, 1);
    expect(await cursorStore.get()).toBe("cursor-abc");
  });

  // ── Acceptance criterion: reload – no duplicates ─────────────────────────

  it("reconstructed subscriber resumes from persisted cursor – no duplicate events", async () => {
    const event1 = rawEvent({
      id: "evt-r1",
      pagingToken: "cursor-round1",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });

    const shared = new MemoryCursorStore();

    // First run
    globalThis.fetch = rpcResponses([[event1]]) as unknown as typeof fetch;
    const sub1 = makeSub({}, shared);
    const seen: string[] = [];
    sub1.subscribe({
      follow: (e) => {
        seen.push(e.meta.id!);
      },
    });
    await driveCycles(sub1, 1);

    expect(seen).toEqual(["evt-r1"]);
    expect(await shared.get()).toBe("cursor-round1");

    // Second run – simulate reload; new subscriber reads persisted cursor
    const event2 = rawEvent({
      id: "evt-r2",
      pagingToken: "cursor-round2",
      topics: [enc("follow")],
      data: enc({ follower: "GC", followee: "GD" }),
    });

    let capturedCursor: string | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as {
        params: { pagination?: { cursor?: string } };
      };
      capturedCursor = body.params.pagination?.cursor;
      return {
        ok: true,
        json: async () => ({ result: { events: [event2], latestLedger: 101 } }),
      };
    }) as unknown as typeof fetch;

    const sub2 = makeSub({}, shared);
    // Prime cursor from store (mimics start() loading it)
    const storedCursor = await shared.get();
    (sub2 as unknown as { cursor: string | undefined }).cursor = storedCursor;

    sub2.subscribe({
      follow: (e) => {
        seen.push(e.meta.id!);
      },
    });
    await driveCycles(sub2, 1);

    // The persisted cursor must have been forwarded to the RPC
    expect(capturedCursor).toBe("cursor-round1");
    // No duplicate of evt-r1; only new evt-r2 was added
    expect(seen).toEqual(["evt-r1", "evt-r2"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Reconnection with exponential backoff after RPC 503 errors
// ---------------------------------------------------------------------------

describe("Reconnection with backoff after RPC errors", () => {
  let savedFetch: typeof globalThis.fetch;
  beforeEach(() => {
    savedFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  // ── Acceptance criterion: 503×2 then success – no events missed ──────────

  it("retries after 503 twice then succeeds – no events missed, cursor advances", async () => {
    const followEvent = rawEvent({
      id: "evt-retry-1",
      pagingToken: "cursor-after-retry",
      topics: [enc("follow")],
      data: enc({ follower: "GA", followee: "GB" }),
    });

    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 503, statusText: "Service Unavailable" };
      }
      return {
        ok: true,
        json: async () => ({ result: { events: [followEvent], latestLedger: 100 } }),
      };
    }) as unknown as typeof fetch;

    const cursorStore = new MemoryCursorStore();
    const sub = makeSub({ minPollIntervalMs: 100, maxPollIntervalMs: 5000 }, cursorStore);
    const received: LinkoraEvent[] = [];
    sub.subscribe({
      follow: (e) => {
        received.push(e);
      },
    });

    // Drive the 2 failing cycles so backoff accumulates
    await driveCycles(sub, 2);

    // After two backoffs the interval must have grown beyond min
    const backedOffInterval = priv(sub).pollIntervalMs;
    expect(backedOffInterval).toBeGreaterThan(100);

    // Drive the third (successful) cycle
    await driveCycles(sub, 1);

    // The successful call delivers the event and no events were missed
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("follow");
    expect((received[0] as FollowEvent).follower).toBe("GA");

    // Cursor advanced after recovery
    expect(await cursorStore.get()).toBe("cursor-after-retry");
  });

  it("backoff never exceeds maxPollIntervalMs", () => {
    const sub = makeSub({ minPollIntervalMs: 100, maxPollIntervalMs: 5000 });
    for (let i = 0; i < 20; i++) priv(sub).backoff();
    expect(priv(sub).pollIntervalMs).toBe(5000);
  });

  it("poll interval resets to min on a full page of events", () => {
    const sub = makeSub({ minPollIntervalMs: 100, maxPollIntervalMs: 5000, pageLimit: 2 });
    // Back off first
    priv(sub).backoff();
    priv(sub).backoff();
    expect(priv(sub).pollIntervalMs).toBeGreaterThan(100);
    // Full page → reset
    priv(sub).updatePollInterval(2);
    expect(priv(sub).pollIntervalMs).toBe(100);
  });

  it("reconnects with exponential backoff after a WebSocket closes", async () => {
    type TestSocket = {
      onopen: (() => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onclose: (() => void) | null;
      onerror: (() => void) | null;
      send: jest.Mock;
      close: jest.Mock;
    };
    const sockets: TestSocket[] = [];
    const factory = jest.fn(() => {
      const socket: TestSocket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: jest.fn(),
        close: jest.fn(() => {
          setTimeout(() => (socket.onclose as (() => void) | null)?.(), 0);
        }),
      };
      sockets.push(socket);
      setTimeout(() => {
        (socket.onopen as (() => void) | null)?.();
        (socket.onclose as (() => void) | null)?.();
      }, 0);
      return socket;
    });

    const sub = makeSub({
      webSocketUrl: "wss://events.example.test",
      webSocketFactory: factory,
      minPollIntervalMs: 1,
      maxPollIntervalMs: 4,
    });

    await sub.start();
    for (let i = 0; i < 20 && factory.mock.calls.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await sub.stop();

    expect(factory.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sockets[0].send).toHaveBeenCalledWith(expect.stringContaining("subscribe"));
  });
});

// ---------------------------------------------------------------------------
// 5. CursorStore backends
// ---------------------------------------------------------------------------

describe("CursorStore backends", () => {
  // ── MemoryCursorStore ────────────────────────────────────────────────────

  describe("MemoryCursorStore", () => {
    it("returns undefined before any set", async () => {
      expect(await new MemoryCursorStore().get()).toBeUndefined();
    });

    it("persists and retrieves a cursor", async () => {
      const store = new MemoryCursorStore();
      await store.set("cursor-123");
      expect(await store.get()).toBe("cursor-123");
    });

    it("clear() resets to undefined", async () => {
      const store = new MemoryCursorStore("initial");
      await store.clear();
      expect(await store.get()).toBeUndefined();
    });

    it("constructor initialCursor is pre-loaded", async () => {
      expect(await new MemoryCursorStore("boot-cursor").get()).toBe("boot-cursor");
    });
  });

  // ── LocalStorageCursorStore ──────────────────────────────────────────────

  describe("LocalStorageCursorStore", () => {
    let mockLS: {
      store: Record<string, string>;
      getItem: jest.Mock;
      setItem: jest.Mock;
      removeItem: jest.Mock;
    };

    beforeEach(() => {
      mockLS = {
        store: {},
        getItem: jest.fn((k: string) => mockLS.store[k] ?? null),
        setItem: jest.fn((k: string, v: string) => {
          mockLS.store[k] = v;
        }),
        removeItem: jest.fn((k: string) => {
          delete mockLS.store[k];
        }),
      };
      (globalThis as { localStorage?: unknown }).localStorage = mockLS;
    });

    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it("returns undefined when key is absent", async () => {
      expect(await new LocalStorageCursorStore("tk").get()).toBeUndefined();
    });

    it("persists cursor to localStorage", async () => {
      const store = new LocalStorageCursorStore("tk");
      await store.set("lc-cursor");
      expect(mockLS.store["tk"]).toBe("lc-cursor");
      expect(await store.get()).toBe("lc-cursor");
    });

    it("clear() removes the key", async () => {
      const store = new LocalStorageCursorStore("tk");
      await store.set("lc-cursor");
      await store.clear();
      expect(await store.get()).toBeUndefined();
    });
  });

  describe("SecureStoreCursorStore", () => {
    it("persists cursor through a SecureStore adapter", async () => {
      const values: Record<string, string> = {};
      const secureStore = {
        getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
        setItemAsync: jest.fn(async (key: string, value: string) => {
          values[key] = value;
        }),
        deleteItemAsync: jest.fn(async (key: string) => {
          delete values[key];
        }),
      };
      const store = new SecureStoreCursorStore(secureStore, "secure-key");

      await store.set("secure-cursor");
      expect(await store.get()).toBe("secure-cursor");
      await store.clear();
      expect(await store.get()).toBeUndefined();
    });
  });

  // ── FileCursorStore ──────────────────────────────────────────────────────
  // The implementation uses require() dynamically; we test it by instantiating
  // with an explicit path and injecting mock fs via a spy on the module's
  // internal getFs helper. Since that function checks typeof require, we test
  // the store methods directly using a MemoryCursorStore stand-in for the
  // read/write behaviour, and we test FileCursorStore.get/set/clear through
  // a controlled integration approach.

  describe("FileCursorStore – ENOENT handling via MemoryCursorStore contract", () => {
    // The file store contract: undefined on ENOENT, string after set, undefined after clear.
    // We verify the same contract holds for MemoryCursorStore (base case) and separately
    // test FileCursorStore's error-mapping logic in isolation below.

    it("MemoryCursorStore satisfies the same get/set/clear contract", async () => {
      const store = new MemoryCursorStore();
      expect(await store.get()).toBeUndefined(); // no file → undefined
      await store.set("the-cursor");
      expect(await store.get()).toBe("the-cursor"); // after write → value
      await store.clear();
      expect(await store.get()).toBeUndefined(); // after delete → undefined
    });

    it("FileCursorStore.get() returns undefined on ENOENT without throwing", async () => {
      // Directly test the ENOENT guard in FileCursorStore.get()
      const store = new FileCursorStore("/nonexistent-path-that-does-not-exist");
      // In a real Node.js test env, the file won't exist → must return undefined
      // Without a real filesystem interaction we verify it doesn't throw
      const result = await store.get().catch(() => "THREW");
      expect(result === undefined || result === "THREW").toBe(true);
      if (result === "THREW") {
        throw new Error("FileCursorStore.get() must not throw for missing files – returned THREW");
      }
    });

    it("FileCursorStore.clear() is silent on ENOENT", async () => {
      const store = new FileCursorStore("/nonexistent-path");
      await expect(store.clear()).resolves.not.toThrow();
    });
  });

  // ── createDefaultCursorStore environment detection ───────────────────────

  describe("createDefaultCursorStore", () => {
    // We test the two branches we can reliably control in a Jest environment:
    // 1. localStorage present → LocalStorageCursorStore
    // 2. localStorage absent  → some store (FileCursorStore in Node; Memory in browser)
    // The exact fallback in Node.js depends on require/fs availability.

    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it("returns LocalStorageCursorStore when localStorage is available", () => {
      (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };
      const { createDefaultCursorStore } =
        jest.requireActual<typeof import("../events/cursor")>("../events/cursor");
      expect(createDefaultCursorStore()).toBeInstanceOf(LocalStorageCursorStore);
    });

    it("returns a usable store even without localStorage (Node.js / memory fallback)", () => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      const { createDefaultCursorStore } =
        jest.requireActual<typeof import("../events/cursor")>("../events/cursor");
      const store = createDefaultCursorStore();
      // Must implement CursorStore contract regardless of which backend is chosen
      expect(typeof store.get).toBe("function");
      expect(typeof store.set).toBe("function");
      expect(typeof store.clear).toBe("function");
    });
  });
});
