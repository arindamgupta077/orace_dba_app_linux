import type { NextConfig } from "next";

// Fix node-oracledb TIMESTAMP timezone interpretation.
// Oracle stores TIMESTAMP(6) values in UTC. node-oracledb builds JS Date
// objects by treating the raw stored value as the Node.js process local
// timezone. If the host OS timezone is not UTC (e.g. IST, UTC+5:30) that causes
// a shift. Forcing TZ=UTC makes the Node.js process always interpret timestamps
// as UTC, which is correct and ensures formatDateTime() displays IST properly.
process.env.TZ = "UTC";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["oracledb"],
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-select", "@radix-ui/react-tabs"]
  }
};

export default nextConfig;
