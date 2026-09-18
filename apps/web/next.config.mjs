/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ai-study-companion/shared", "@ai-study-companion/validation"],
  // Workspace packages use ESM-style `.js` import suffixes for their `.ts`
  // sources (NodeNext-correct). Teach webpack to resolve them.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  },
};

export default nextConfig;
