export function BrandLogo({ compact = false, print = false }: { compact?: boolean; print?: boolean }) {
  if (compact) return <img src="/brand/mark.svg" alt="Marquinhos" width={42} height={42} className="brand-mark" />;
  if (print) return <img src="/brand/marquinhos-logo.svg" alt="Marquinhos Calhas e Esquadrias" className="brand-logo" width={234} height={80} />;
  return <span className="brand-logo-pair">
    <img src="/brand/marquinhos-logo-negativo-fundo-escuro.svg" alt="Marquinhos Calhas e Esquadrias" width={234} height={80} className="brand-logo brand-logo-dark" />
    <img src="/brand/marquinhos-logo.svg" alt="Marquinhos Calhas e Esquadrias" width={234} height={80} className="brand-logo brand-logo-light" />
  </span>;
}

export function AuthorSignature({ className = "" }: { className?: string }) {
  return <span className={`author-signature ${className}`}>by <strong>Anderson Bielenki</strong></span>;
}
