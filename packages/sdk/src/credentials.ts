import { sha256 } from "@noble/hashes/sha256";

export interface CredentialMerkleProof {
  root: Uint8Array;
  proof: Uint8Array[];
}

function assertLeaf(leaf: Uint8Array): void {
  if (leaf.length !== 32) {
    throw new Error("Credential Merkle leaves must be 32-byte SHA-256 hashes");
  }
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

/**
 * Builds a Merkle root and inclusion proof for a 32-byte credential leaf.
 *
 * Leaves are expected to be sha256(credential_type || credential_value || salt).
 * Sibling pairs are sorted before hashing so the proof does not need direction
 * bits and can be verified by the Soroban contract with only Vec<BytesN<32>>.
 */
export function generateCredentialMerkleProof(
  leaves: Uint8Array[],
  targetLeafIndex: number
): CredentialMerkleProof {
  if (leaves.length === 0) {
    throw new Error("Cannot build a credential Merkle proof for an empty tree");
  }
  if (targetLeafIndex < 0 || targetLeafIndex >= leaves.length) {
    throw new Error("targetLeafIndex is out of bounds");
  }

  let level: Uint8Array[] = leaves.map((leaf) => {
    assertLeaf(leaf);
    return new Uint8Array(leaf);
  });

  const proof: Uint8Array[] = [];
  let index = targetLeafIndex;

  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]);
    }

    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(new Uint8Array(level[siblingIndex]));

    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(hashPair(level[i], level[i + 1]));
    }

    level = nextLevel;
    index = Math.floor(index / 2);
  }

  return {
    root: level[0],
    proof,
  };
}
