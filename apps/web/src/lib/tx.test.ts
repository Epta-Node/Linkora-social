import { signAndSubmitTransaction, buildSignAndSubmit } from './tx';
import {
  TransactionBuilder,
  Contract,
  rpc as StellarRpc,
} from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';

jest.mock('@stellar/stellar-sdk', () => {
  const fromXDR = jest.fn();
  const TransactionBuilderMock = jest.fn();
  (TransactionBuilderMock as unknown as { fromXDR: unknown }).fromXDR = fromXDR;

  return {
    BASE_FEE: 100,
    TransactionBuilder: TransactionBuilderMock,
    Contract: jest.fn(),
    Address: { fromString: jest.fn() },
    Transaction: jest.fn(),
    xdr: {},
    rpc: {
      Server: jest.fn(),
      Api: { isSimulationError: jest.fn() },
      assembleTransaction: jest.fn(),
    },
  };
});

jest.mock('@stellar/freighter-api', () => ({
  signTransaction: jest.fn(),
}));

const mockFromXDR = TransactionBuilder.fromXDR as unknown as jest.Mock;
const mockSignTransaction = signTransaction as jest.Mock;
const mockIsSimulationError = StellarRpc.Api.isSimulationError as unknown as jest.Mock;
const mockAssembleTransaction = StellarRpc.assembleTransaction as unknown as jest.Mock;

const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();

const CONFIG = {
  contractId: 'CDUMMY',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2022',
};

const builtTx = { toXDR: () => 'base64XDR' };
const transactionBuilderChain = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue(builtTx),
};

beforeEach(() => {
  jest.clearAllMocks();
  (StellarRpc.Server as unknown as jest.Mock).mockImplementation(() => ({
    sendTransaction: mockSendTransaction,
    getTransaction: mockGetTransaction,
    getAccount: mockGetAccount,
    simulateTransaction: mockSimulateTransaction,
  }));
  mockFromXDR.mockReturnValue({ signedTx: true });
  mockSignTransaction.mockResolvedValue('signedXDR');
});

describe('signAndSubmitTransaction', () => {
  it('signs, submits and returns the confirmed hash', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'abc123' });

    await expect(signAndSubmitTransaction('unsignedXDR', CONFIG)).resolves.toEqual({
      hash: 'abc123',
      status: 'SUCCESS',
    });

    expect(mockSignTransaction).toHaveBeenCalledWith('unsignedXDR', {
      networkPassphrase: CONFIG.networkPassphrase,
    });
    expect(mockFromXDR).toHaveBeenCalledWith('signedXDR', CONFIG.networkPassphrase);
    expect(mockSendTransaction).toHaveBeenCalledWith({ signedTx: true });
  });

  it('polls until the transaction leaves the PENDING state', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    mockGetTransaction
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    await expect(signAndSubmitTransaction('unsignedXDR', CONFIG)).resolves.toEqual({
      hash: 'abc123',
      status: 'SUCCESS',
    });

    expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    expect(mockGetTransaction).toHaveBeenCalledWith('abc123');
  });

  it('throws when submission is rejected up front', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'abc123' });

    await expect(signAndSubmitTransaction('unsignedXDR', CONFIG)).rejects.toThrow(
      'Transaction failed to submit'
    );
  });

  it('throws when the transaction fails during execution', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    mockGetTransaction.mockResolvedValue({ status: 'FAILED' });

    await expect(signAndSubmitTransaction('unsignedXDR', CONFIG)).rejects.toThrow(
      'Transaction failed during execution'
    );
  });

  it('throws when the wallet rejects the signature', async () => {
    mockSignTransaction.mockRejectedValue(new Error('Signing failed'));

    await expect(signAndSubmitTransaction('unsignedXDR', CONFIG)).rejects.toThrow('Signing failed');
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

describe('buildSignAndSubmit', () => {
  it('simulates, assembles and submits the encoded transaction XDR', async () => {
    mockGetAccount.mockResolvedValue({ accountId: 'GALICE', sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: 'ok' });
    mockIsSimulationError.mockReturnValue(false);
    mockAssembleTransaction.mockReturnValue(transactionBuilderChain);
    mockSendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'def456' });

    const call = jest.fn();
    (Contract as unknown as jest.Mock).mockImplementation(() => ({ call }));
    (TransactionBuilder as unknown as jest.Mock).mockImplementation(() => transactionBuilderChain);

    const scval = { toString: () => 'scval' } as never;
    const result = await buildSignAndSubmit('like_post', [scval], 'GALICE', CONFIG);

    expect(result).toEqual({ hash: 'def456', status: 'SUCCESS' });
    expect(Contract).toHaveBeenCalledWith(CONFIG.contractId);
    expect(call).toHaveBeenCalledWith('like_post', scval);
    expect(transactionBuilderChain.setTimeout).toHaveBeenCalledWith(30);
    expect(mockSimulateTransaction).toHaveBeenCalledWith(builtTx);
    expect(mockAssembleTransaction).toHaveBeenCalledWith(builtTx, { result: 'ok' });
    expect(mockSignTransaction).toHaveBeenCalledWith('base64XDR', {
      networkPassphrase: CONFIG.networkPassphrase,
    });
  });

  it('surfaces simulation errors instead of submitting a doomed transaction', async () => {
    mockGetAccount.mockResolvedValue({ accountId: 'GALICE', sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ error: 'insufficient balance' });
    mockIsSimulationError.mockReturnValue(true);

    await expect(buildSignAndSubmit('like_post', [], 'GALICE', CONFIG)).rejects.toThrow(
      'Transaction simulation failed: insufficient balance'
    );
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});