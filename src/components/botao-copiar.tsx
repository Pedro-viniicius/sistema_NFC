"use client";

import { useState } from "react";
import { classesDoBotao } from "./ui";

interface Props {
  texto: string;
  rotulo?: string;
  className?: string;
}

/** Copia um texto (ex.: a URL permanente para gravar no NFC) para a área de transferência. */
export function BotaoCopiar({ texto, rotulo = "Copiar URL", className }: Props) {
  const [estado, setEstado] = useState<"inicial" | "copiado" | "erro">("inicial");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("erro");
    }
    window.setTimeout(() => setEstado("inicial"), 2000);
  }

  return (
    <button type="button" onClick={copiar} className={className ?? classesDoBotao("secundario")}>
      {estado === "copiado" ? "Copiado!" : estado === "erro" ? "Não foi possível copiar" : rotulo}
    </button>
  );
}
