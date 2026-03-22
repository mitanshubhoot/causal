/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@causal/types"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.CAUSAL_API_URL ?? "http://localhost:3001"}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
