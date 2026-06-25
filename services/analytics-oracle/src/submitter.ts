import {
  rpc,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";

const DEFAULT_TIMEOUT = 30;

export async function submitAttestation(
  rpcUrl: string,
  networkPassphrase: string,
  contractId: string,
  oracleName: string,
  reportCbor: Buffer,
  signature: Buffer,
  oracleKeypair: Keypair,
  creatorAddress: string,
  windowStart: bigint,
  windowEnd: bigint
): Promise<string> {
  const server = new rpc.Server(rpcUrl);

  const op = new Contract(contractId).call(
    "verify_analytics_attestation",
    nativeToScVal(oracleName, { type: "symbol" }),
    nativeToScVal(reportCbor, { type: "bytes" }),
    xdr.ScVal.scvBytes(signature),
    nativeToScVal(creatorAddress, { type: "address" }),
    nativeToScVal(windowStart, { type: "u64" }),
    nativeToScVal(windowEnd, { type: "u64" })
  );

  const sourceAccount = await server.getAccount(oracleKeypair.publicKey());
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "1000",
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(DEFAULT_TIMEOUT)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(oracleKeypair);
  const result = await server.sendTransaction(prepared);
  return result.hash;
}
