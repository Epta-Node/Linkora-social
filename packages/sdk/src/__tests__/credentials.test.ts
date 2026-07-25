import { sha256 } from '@noble/hashes/sha256';
import { generateCredentialMerkleProof } from '../credentials';

function leaf(seed: number): Uint8Array {
  return sha256(new Uint8Array([seed]));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) {
      return -1;
    }
    if (left[i] > right[i]) {
      return 1;
    }
  }

  return 0;
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const [first, second] = compareBytes(left, right) <= 0 ? [left, right] : [right, left];
  const combined = new Uint8Array(64);
  combined.set(first, 0);
  combined.set(second, 32);
  return sha256(combined);
}

describe('generateCredentialMerkleProof', () => {
  it('generates a proof that recomputes to the root', () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const { root, proof } = generateCredentialMerkleProof(leaves, 2);

    const computed = proof.reduce((node, sibling) => hashPair(node, sibling), leaves[2]);

    expect(Buffer.from(computed).toString('hex')).toEqual(Buffer.from(root).toString('hex'));
    expect(proof).toHaveLength(2);
  });

  it('supports a 1024-leaf tree', () => {
    const leaves = Array.from({ length: 1024 }, (_, index) => leaf(index % 251));
    const { root, proof } = generateCredentialMerkleProof(leaves, 511);
    const computed = proof.reduce((node, sibling) => hashPair(node, sibling), leaves[511]);

    expect(Buffer.from(computed).toString('hex')).toEqual(Buffer.from(root).toString('hex'));
    expect(proof).toHaveLength(10);
  });

  it('rejects invalid inputs', () => {
    expect(() => generateCredentialMerkleProof([], 0)).toThrow('empty tree');
    expect(() => generateCredentialMerkleProof([new Uint8Array(31)], 0)).toThrow('32-byte');
    expect(() => generateCredentialMerkleProof([leaf(1)], 1)).toThrow('out of bounds');
  });
});
