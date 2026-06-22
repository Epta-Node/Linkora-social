import { NextResponse } from "next/server";
import { LinkoraClient } from "linkora-sdk";

// In-memory store for proposals to support mock mode additions and updates during tests
let mockProposals = [
  {
    id: 1,
    proposer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    parameter: "FeeBps",
    new_value: 500,
    new_address: null,
    votes_for: 75000,
    votes_against: 25000,
    created_ledger: 1000,
    status: "Executed",
  },
  {
    id: 2,
    proposer: "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
    parameter: "TipCooldownWindow",
    new_value: 3600,
    new_address: null,
    votes_for: 120000,
    votes_against: 40000,
    created_ledger: 12345,
    status: "Active",
  },
  {
    id: 3,
    proposer: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
    parameter: "GovQuorum",
    new_value: 50,
    new_address: null,
    votes_for: 200000,
    votes_against: 10000,
    created_ledger: 12350,
    status: "Active",
  },
  {
    id: 4,
    proposer: "GDFOHLMYCXVZD2CDXZLMIRQZPEAXE7B5MURMIZ4IYQUENHZSJPINMQB",
    parameter: "Treasury",
    new_value: 0,
    new_address: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    votes_for: 10000,
    votes_against: 180000,
    created_ledger: 11000,
    status: "Vetoed",
  },
];

export async function GET() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || process.env.CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || process.env.SOROBAN_RPC_URL;

  if (contractId && rpcUrl) {
    try {
      const client = new LinkoraClient({ contractId, rpcUrl });
      const proposals = [];
      let id = 1;
      
      // Sequential fetching loop
      while (true) {
        try {
          const prop = await client.govGetProposal(id);
          if (!prop) break;
          proposals.push(prop);
          id++;
        } catch (err) {
          // Break when proposal not found
          break;
        }
      }

      if (proposals.length > 0) {
        return NextResponse.json(proposals);
      }
    } catch (e) {
      console.warn("Failed to fetch proposals from contract, falling back to mock", e);
    }
  }

  return NextResponse.json(mockProposals);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, proposalId, support, proposer, parameter, newValue, newAddress } = body;

    if (action === "create") {
      const newProp = {
        id: mockProposals.length + 1,
        proposer: proposer || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        parameter: parameter || "FeeBps",
        new_value: Number(newValue) || 0,
        new_address: newAddress || null,
        votes_for: 0,
        votes_against: 0,
        created_ledger: 12400,
        status: "Active",
      };
      mockProposals.push(newProp);
      return NextResponse.json({ success: true, proposal: newProp });
    }

    if (action === "vote") {
      const prop = mockProposals.find((p) => p.id === Number(proposalId));
      if (!prop) {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      if (support) {
        prop.votes_for += 10000; // Simulate vote weight
      } else {
        prop.votes_against += 10000;
      }
      return NextResponse.json({ success: true, proposal: prop });
    }

    if (action === "veto") {
      const prop = mockProposals.find((p) => p.id === Number(proposalId));
      if (!prop) {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      prop.status = "Vetoed";
      return NextResponse.json({ success: true, proposal: prop });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
