import { Keypair } from '@stellar/stellar-sdk';
import { AuthService, AuthError, AuthData } from '../auth';

function makeKeypair(): Keypair {
  return Keypair.random();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function validAuth(senderKp: Keypair, recipientKp: Keypair, nonce: number, ts: number): AuthData {
  return {
    sender: senderKp.publicKey(),
    to: recipientKp.publicKey(),
    nonce,
    timestamp: ts,
    signature: AuthService.createAuthSignature(senderKp, recipientKp.publicKey(), nonce, ts),
  };
}

describe('AuthService.verifyMessageAuth', () => {
  const service = new AuthService(30);
  const sender = makeKeypair();
  const recipient = makeKeypair();

  it('accepts a valid signature', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 0, ts);
    expect(service.verifyMessageAuth(auth)).toBe(true);
  });

  it('accepts nonce values other than 0', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 42, ts);
    expect(service.verifyMessageAuth(auth)).toBe(true);
  });

  it('rejects an invalid (tampered) signature', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 0, ts);
    // Flip one hex digit to corrupt the signature
    auth.signature = auth.signature.slice(0, -2) + 'ff';
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
  });

  it('rejects a signature from the wrong keypair', () => {
    const imposter = makeKeypair();
    const ts = nowSec();
    const sig = AuthService.createAuthSignature(imposter, recipient.publicKey(), 0, ts);
    const auth: AuthData = {
      sender: sender.publicKey(), // claims to be sender
      to: recipient.publicKey(),
      nonce: 0,
      timestamp: ts,
      signature: sig, // but actually signed by imposter
    };
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
  });

  it('rejects a signature over wrong recipient', () => {
    const other = makeKeypair();
    const ts = nowSec();
    // Signed for 'other', claimed to be for 'recipient'
    const sig = AuthService.createAuthSignature(sender, other.publicKey(), 0, ts);
    const auth: AuthData = {
      sender: sender.publicKey(),
      to: recipient.publicKey(),
      nonce: 0,
      timestamp: ts,
      signature: sig,
    };
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
  });

  it('rejects a signature over wrong nonce', () => {
    const ts = nowSec();
    const sig = AuthService.createAuthSignature(sender, recipient.publicKey(), 5, ts);
    const auth: AuthData = {
      sender: sender.publicKey(),
      to: recipient.publicKey(),
      nonce: 6, // different nonce than what was signed
      timestamp: ts,
      signature: sig,
    };
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
  });

  it('rejects an expired timestamp (too old)', () => {
    const expiredTs = nowSec() - 60; // 60s ago, max skew is 30s
    const auth = validAuth(sender, recipient, 0, expiredTs);
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
    expect(() => service.verifyMessageAuth(auth)).toThrow(/Timestamp/);
  });

  it('rejects a future timestamp beyond max skew', () => {
    const futureTs = nowSec() + 60;
    const auth = validAuth(sender, recipient, 0, futureTs);
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
    expect(() => service.verifyMessageAuth(auth)).toThrow(/Timestamp/);
  });

  it('accepts a timestamp exactly at the skew boundary', () => {
    const ts = nowSec() - 29; // 29s old, max skew is 30s
    const auth = validAuth(sender, recipient, 0, ts);
    expect(service.verifyMessageAuth(auth)).toBe(true);
  });

  it('rejects an invalid sender Stellar address', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 0, ts);
    auth.sender = 'NOT_A_STELLAR_KEY';
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
    expect(() => service.verifyMessageAuth(auth)).toThrow(/Invalid sender/);
  });

  it('rejects an invalid recipient Stellar address', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 0, ts);
    auth.to = 'INVALID';
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
    expect(() => service.verifyMessageAuth(auth)).toThrow(/Invalid recipient/);
  });

  it('rejects a signature with wrong byte length (not 64 bytes / 128 hex)', () => {
    const ts = nowSec();
    const auth = validAuth(sender, recipient, 0, ts);
    auth.signature = 'deadbeef'; // too short
    expect(() => service.verifyMessageAuth(auth)).toThrow(AuthError);
  });
});
