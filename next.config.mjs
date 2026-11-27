/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // BullMQ and ioredis are Node.js worker/queue libraries. Keep them external
  // to the Next.js server bundle so BullMQ's optional Valkey adapter is not
  // eagerly resolved by the browser-oriented bundler.
  serverExternalPackages: ["bullmq", "ioredis"],
};
export default nextConfig;
