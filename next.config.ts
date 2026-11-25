import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
      poweredByHeader: false,
      // Versão de cada publicação: uma aba aberta com a versão antiga recarrega ao navegar em vez de quebrar.
      deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.DEPLOY_ID || undefined,
      async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
      experimental: { serverActions: { bodySizeLimit: "12mb" } },
      outputFileTracingIncludes: { "/*": ["./public/catalogo/pecas/*.png", "./public/catalogo/obra/*.png", "./public/brand/*.svg", "./public/fonts/*"] },
      serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};
      

export default nextConfig;
