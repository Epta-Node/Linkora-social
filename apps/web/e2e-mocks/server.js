const express = require("express");

const FRIENDLY_USERS = [
  "stellar_dev",
  "crypto_enthusiast",
  "linkora_fan",
  "soroban_builder",
  "defi_explorer",
  "nft_collector",
  "dao_member",
  "web3_builder",
  "crypto_trader",
  "soroban_dev",
  "alice",
  "bob",
  "charlie",
  "dave",
  "eve",
  "frank",
  "grace",
  "heidi",
  "ivan",
  "judy",
  "mallory",
  "oscar",
  "peggy",
  "rupert",
  "sybil",
];

const MOCK_USERS = Array.from({ length: 75 }, (_, i) => {
  const index = i + 1;
  const prefix = String.fromCharCode(65 + (i % 26));
  const address = `G${prefix}${Array(53).fill("X").join("")}${index.toString().padStart(2, "0")}`;
  const username = i < FRIENDLY_USERS.length ? FRIENDLY_USERS[i] : `user_${index}`;
  return { address, username };
});

/* ── 1. API Server (Port 3001) ────────────────────────────────────────── */

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/posts", (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const author = req.query.author || MOCK_USERS[0].address;

  const posts = [
    {
      id: "post_1",
      author,
      deleted: false,
      tip_total: "100",
      like_count: "5",
      created_ledger: 1000,
      deleted_ledger: null,
    },
    {
      id: "post_2",
      author,
      deleted: false,
      tip_total: "50",
      like_count: "2",
      created_ledger: 990,
      deleted_ledger: null,
    },
  ];

  res.json({
    posts: posts.slice(offset, offset + limit),
    total: posts.length,
    limit,
    offset,
    has_more: false,
  });
});

app.get("/api/users/:userId/followers", (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const paginated = MOCK_USERS.slice(offset, offset + limit);
  res.json({
    userId: req.params.userId,
    followers: paginated,
    total: MOCK_USERS.length,
    limit,
    offset,
    has_more: offset + paginated.length < MOCK_USERS.length,
  });
});

app.get("/api/users/:userId/following", (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const paginated = MOCK_USERS.slice(offset, offset + limit);
  res.json({
    userId: req.params.userId,
    following: paginated,
    total: MOCK_USERS.length,
    limit,
    offset,
    has_more: offset + paginated.length < MOCK_USERS.length,
  });
});

app.get("/api/follows/:address/followers", (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const targetAddress = req.params.address;
  const filteredMock = MOCK_USERS.filter((u) => u.address.toLowerCase() !== targetAddress.toLowerCase());
  const paginated = filteredMock.slice(offset, offset + limit);

  res.json({
    address: targetAddress,
    followers: paginated,
    total: filteredMock.length,
    limit,
    offset,
    has_more: offset + paginated.length < filteredMock.length,
  });
});

app.get("/api/follows/:address/following", (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const targetAddress = req.params.address;
  const filteredMock = MOCK_USERS.filter((u) => u.address.toLowerCase() !== targetAddress.toLowerCase());
  const paginated = filteredMock.slice(offset, offset + limit);

  res.json({
    address: targetAddress,
    following: paginated,
    total: filteredMock.length,
    limit,
    offset,
    has_more: offset + paginated.length < filteredMock.length,
  });
});

app.get("/api/profiles/:address", (req, res) => {
  const addr = req.params.address;
  const user = MOCK_USERS.find((u) => u.address.toLowerCase() === addr.toLowerCase());
  res.json({
    address: addr,
    username: user ? user.username : `user_${addr.slice(0, 6)}`,
    bio: "Linkora community member",
    creator_token: "",
  });
});

const API_PORT = process.env.PORT || 3001;
app.listen(API_PORT, () => {
  console.log(`Mock API Server running on http://localhost:${API_PORT}`);
});

/* ── 2. Soroban RPC Stub (Port 8000) ─────────────────────────────────── */

const rpcApp = express();
rpcApp.use(express.json());

rpcApp.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

rpcApp.get("/health", (req, res) => res.json({ status: "healthy" }));

const handleRpc = (req, res) => {
  const { id, method, params } = req.body || {};
  let result = {};

  if (method === "getAccount") {
    result = {
      id: params?.[0] || "GAHECF2UDYZSEO7RSIV24ZDVEFMF3IPKDJ65O54NQDUXG2JL6A35IOSG",
      sequence: "123456789",
      balances: [],
    };
  } else if (method === "simulateTransaction") {
    result = {
      minFee: "100",
      cost: { cpuInsns: "100", memBytes: "100" },
      results: [{ auth: [], retval: "AAAAAQ==" }],
      latestLedger: 1000,
    };
  } else if (method === "sendTransaction") {
    result = {
      status: "SUCCESS",
      hash: "0000000000000000000000000000000000000000000000000000000000000000",
      latestLedger: 1000,
      latestLedgerCloseTime: "1600000000",
    };
  } else if (method === "getTransaction") {
    result = {
      status: "SUCCESS",
      hash: "0000000000000000000000000000000000000000000000000000000000000000",
      latestLedger: 1000,
      latestLedgerCloseTime: "1600000000",
    };
  } else if (method === "getHealth") {
    result = { status: "healthy" };
  }

  res.json({
    jsonrpc: "2.0",
    id: id || 1,
    result,
  });
};

rpcApp.post("/rpc", handleRpc);
rpcApp.post("/", handleRpc);
rpcApp.get("/rpc", (req, res) => res.json({ status: "healthy" }));

const RPC_PORT = process.env.RPC_PORT || 8000;
rpcApp.listen(RPC_PORT, () => {
  console.log(`Mock Soroban RPC Server running on http://localhost:${RPC_PORT}`);
});
