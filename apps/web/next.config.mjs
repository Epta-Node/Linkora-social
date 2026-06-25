/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["linkora-sdk"],
  typescript: {
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
