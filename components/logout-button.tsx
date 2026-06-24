"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      title="Sair da conta"
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 transition hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50"
    >
      <LogOut className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && (loading ? "Saindo…" : "Sair da conta")}
    </button>
  );
}
