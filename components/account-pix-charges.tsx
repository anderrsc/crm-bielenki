"use client";
// Extrato por conta: cobranças Pix enviadas para esta conta que ainda não foram confirmadas.
import { useRouter } from "next/navigation";
import { PixChargeList } from "@/components/pix-charge";
import type { PixChargeRow } from "@/app/(crm)/pix-charge-actions";

export function AccountPixCharges({ charges }: { charges: PixChargeRow[] }) {
  const router = useRouter();
  if (!charges.length) return null;
  const total = charges.reduce((s, c) => s + c.amount, 0);
  return <section className="no-print mx-auto mt-4 max-w-[210mm] rounded-xl border border-amber-200 bg-amber-50 p-4 text-[#111]">
    <p className="text-sm font-semibold">Cobranças Pix aguardando pagamento nesta conta: {charges.length} · {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
    <p className="mb-3 text-xs text-[#555]">Ainda não entram no saldo. Quando o Pix cair, toque em Recebido: a entrada vai para o extrato desta conta.</p>
    <PixChargeList charges={charges} showAccount={false} onChange={() => router.refresh()} />
  </section>;
}
