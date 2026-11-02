import type { NextConfig } from "next";

const nextConfig: NextConfig = {
      outputFileTracingIncludes: { "/*": ["./public/catalogo/pecas/*.png"] },
      serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};
      

export default nextConfig;
