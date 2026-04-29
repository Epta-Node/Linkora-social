// Contract interaction utilities
// Note: This is a simplified implementation for demonstration.
// In production, you would use the actual Stellar SDK to interact with the deployed contract.

export interface Post {
  id: number;
  author: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
}

export interface Profile {
  address: string;
  username: string;
  creator_token: string;
}

// Mock data for development - replace with actual contract calls
const mockPosts: Post[] = [
  {
    id: 1,
    author: 'GABCD1234567890',
    content: 'Just deployed my first smart contract on Stellar! 🚀',
    tip_total: 100,
    timestamp: Date.now() - 3600000,
    like_count: 5,
  },
  {
    id: 2,
    author: 'GXYZ9876543210',
    content: 'The SocialFi ecosystem is growing fast. Excited to be part of it!',
    tip_total: 50,
    timestamp: Date.now() - 7200000,
    like_count: 3,
  },
];

const mockProfiles: Map<string, Profile> = new Map([
  ['GABCD1234567890', {
    address: 'GABCD1234567890',
    username: 'stellar_dev',
    creator_token: 'GABCD1234567890',
  }],
  ['GXYZ9876543210', {
    address: 'GXYZ9876543210',
    username: 'crypto_enthusiast',
    creator_token: 'GXYZ9876543210',
  }],
]);

export async function getFollowing(userAddress: string): Promise<string[]> {
  // TODO: Replace with actual contract call using Stellar SDK
  // For now, return mock data
  return ['GABCD1234567890', 'GXYZ9876543210'];
}

export async function getPostsByAuthor(authorAddress: string): Promise<number[]> {
  // TODO: Replace with actual contract call using Stellar SDK
  // For now, return mock post IDs
  return mockPosts.filter(p => p.author === authorAddress).map(p => p.id);
}

export async function getPost(postId: number): Promise<Post | null> {
  // TODO: Replace with actual contract call using Stellar SDK
  // For now, return mock data
  return mockPosts.find(p => p.id === postId) || null;
}

export async function getProfile(userAddress: string): Promise<Profile | null> {
  // TODO: Replace with actual contract call using Stellar SDK
  // For now, return mock data
  return mockProfiles.get(userAddress) || null;
}
