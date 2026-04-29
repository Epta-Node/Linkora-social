# Linkora Social Web Frontend

Next.js frontend for the Linkora Social SocialFi application on Stellar.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

- **Following Feed**: View posts from accounts you follow at `/feed`
- **Wallet Connection**: Connect with Freighter wallet
- **Post Display**: Beautiful post cards with author info, likes, and tips

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_CONTRACT_ADDRESS`: Your deployed Soroban contract address
- `NEXT_PUBLIC_RPC_URL`: Soroban RPC URL (default: testnet)

## Contract Integration

The frontend currently uses mock data for development. To integrate with the actual contract:

1. Install Stellar SDK:
```bash
npm install @stellar/stellar-sdk @stellar/freighter-api
```

2. Update `lib/contract.ts` to use actual contract calls via the Stellar SDK.

## Building

```bash
npm run build
```

## License

MIT
