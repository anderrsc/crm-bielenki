import type { NextConfig } from "next";

const nextConfig: NextConfig = {
      experimental: { serverActions: { bodySizeLimit: "12mb" } },
      outputFileTracingIncludes: { "/*": ["./public/catalogo/pecas/*.png", "./public/catalogo/obra/*.png", "./public/brand/*.svg", "./public/fonts/*"] },
      serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};
      

export default nextConfig;
