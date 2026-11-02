"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme || "dark"); }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("marquinhos-theme", next); } catch { /* Storage may be unavailable. */ }
    setTheme(next);
  };
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} title={theme === "dark" ? "Tema claro" : "Tema escuro"}>
    {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
  </button>;
}
