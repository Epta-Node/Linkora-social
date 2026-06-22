import { NextResponse } from "next/server";
import { LinkoraClient } from "linkora-sdk";

export async function GET() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || process.env.CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || process.env.SOROBAN_RPC_URL;
  
  if (contractId && rpcUrl) {
    try {
      const client = new LinkoraClient({ contractId, rpcUrl });
      const config = await client.govGetConfig();
      if (config) {
        return NextResponse.json(config);
      }
    } catch (e) {
      console.warn("Failed to fetch governance config from contract, falling back to mock", e);
    }
  }

  const mockConfig = {
    quorum: 60,
    time_lock_ledgers: 100,
    vote_window_ledgers: 200,
    quorum_decay_rate_bps: 50,
    quorum_floor: 30,
  };
  
  return NextResponse.json(mockConfig);
}
