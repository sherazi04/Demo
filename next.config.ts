import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    // Native/heavy Node packages that must not be bundled by Turbopack/webpack.
    "postgres",
    "neo4j-driver",
    "bullmq",
    "ioredis",
    "bcryptjs",
    "unpdf",
    "mammoth",
    // unzipper declares an optional @aws-sdk/client-s3 dependency for reading
    // archives from S3. Nothing here does, but the bundler still tries to
    // resolve it — keeping the package external skips that entirely.
    "unzipper",
  ],
  experimental: {
    serverActions: {
      // Course material uploads are posted through a route handler, but server
      // actions still carry CSV imports and blueprint payloads.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
