import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
      outputFileTracingIncludes: { "/api/orcamentos/[id]/pdf/route": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default nextConfig;
