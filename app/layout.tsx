import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./brand-fonts.css";
import "./brand-tokens.css";
import "./marquinhos.css";
import "./quote-paper.css";
import "./home.css";
import "./mobile.css";
import "./components.css";
import "./forms.css";
import "./glass.css";
import "./typography.css";

// Plus Jakarta Sans: família única da interface (variável 200–800; o sistema usa só 400, 500, 600 e 700). Hospedada no próprio app.
const jakarta = localFont({
  src: "./fonts/PlusJakartaSans-latin-wght.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-jakarta",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = { title: { default: "Marquinhos Calhas e Esquadrias", template: "%s · Marquinhos" }, description: "Gestão, orçamentos e operação da Marquinhos Calhas e Esquadrias — by Anderson Bielenki", applicationName: "Marquinhos Gestão", icons: { icon: "/icon.svg?v=marquinhos-oficial", apple: "/apple-touch-icon.png" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-theme="light" className={jakarta.variable} suppressHydrationWarning><head><meta name="color-scheme" content="light" /></head><body className="min-h-screen antialiased">{children}</body></html>;
}
