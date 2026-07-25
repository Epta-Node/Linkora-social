import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['linkora-sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    // Resolve linkora-sdk to its TypeScript source so Next.js can transpile it
    // directly instead of relying on a pre-built dist/ folder.
    config.resolve.alias['linkora-sdk'] = path.resolve(
      __dirname,
      '../../packages/sdk/src',
    );
    return config;
  },
};

export default nextConfig;
