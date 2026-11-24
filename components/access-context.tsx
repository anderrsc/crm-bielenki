"use client";
import { createContext, useContext } from "react";

/** Quem pode ver cada tela (mesma regra do menu). Permite que componentes de página mostrem só atalhos permitidos. */
export const AccessContext = createContext<(href: string) => boolean>(() => true);
export const useCanSee = () => useContext(AccessContext);
