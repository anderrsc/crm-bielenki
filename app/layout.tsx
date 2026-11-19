import type { Metadata } from "next";
import "./globals.css";
import "./brand-fonts.css";
import "./brand-tokens.css";
import "./marquinhos.css";
import "./quote-paper.css";
import "./mobile.css";

export const metadata: Metadata = { title: { default: "Marquinhos Calhas e Esquadrias", template: "%s · Marquinhos" }, description: "Gestão, orçamentos e operação da Marquinhos Calhas e Esquadrias — by Anderson Bielenki", applicationName: "Marquinhos Gestão", icons: { icon: "/icon.svg?v=marquinhos-oficial", apple: "/apple-touch-icon.png" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-theme="light" suppressHydrationWarning><head><meta name="color-scheme" content="light" /></head><body className="min-h-screen antialiased">{children}</body></html>;
}
