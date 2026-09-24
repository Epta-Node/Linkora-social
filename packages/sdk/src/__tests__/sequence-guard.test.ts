import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-base";
import { NetworkError } from "../errors";
import { TransactionQueue } from "../queue";

const NETWORK = "Test SDF Network ; September 2015";
const SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const DESTINATION = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function transactionXdr(): string {
  return new TransactionBuilder(new Account(SOURCE, "100"), {
    fee: "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({ destination: DESTINATION, asset: Asset.native(), amount: "1" })
    )
    .setTimeout(30)
    .build()
    .toEnvelope()
    .toXDR("base64");
}

describe("account sequence guard (#1350)", () => {
  it("serializes concurrent queues and rejects the second stale sequence", async () => {
    let sequence = "100";
    let ledger = 500;
    let releaseConfirmation!: () => void;
    let notifySubmitted!: () => void;
    const submitted = new Promise<void>((resolve) => {
      notifySubmitted = resolve;
    });
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    const getAccountSequence = jest.fn(async () => ({ sequence, ledger }));
    const rpc = {
      getAccountSequence,
      async simulateTransaction() {
        return { success: true, resourceFee: "100" };
      },
      async sendTransaction() {
        notifySubmitted();
        return { hash: "tx-hash", status: "PENDING" };
      },
      async getTransaction() {
        await confirmationGate;
        sequence = "101";
        ledger = 501;
        return { status: "SUCCESS" };
      },
    };
    const signer = { signTransaction: jest.fn(async (xdr: string) => xdr) };
    const first = new TransactionQueue({
      signer,
      rpc,
      networkPassphrase: NETWORK,
      pollIntervalMs: 0,
    });
    const second = new TransactionQueue({
      signer,
      rpc,
      networkPassphrase: NETWORK,
      pollIntervalMs: 0,
    });
    first.enqueue(transactionXdr());
    second.enqueue(transactionXdr());

    const firstRun = first.run();
    await submitted;
    const secondRun = second.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getAccountSequence).toHaveBeenCalledTimes(1);
    releaseConfirmation();
    await firstRun;
    await expect(secondRun).rejects.toBeInstanceOf(NetworkError);
    expect(getAccountSequence).toHaveBeenCalledTimes(2);
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
  });
});
