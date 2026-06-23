import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = { title: "Ficha de Medidas – Marquinhos Calhas e Esquadrias" };

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body className="bg-white antialiased">{children}</body></html>;
}
