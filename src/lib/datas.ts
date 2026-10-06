const FORMATO_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Data e hora no horário de Brasília (o servidor da Vercel roda em UTC). */
export function formatarDataHora(data: Date | null | undefined): string {
  return data ? FORMATO_DATA_HORA.format(data) : "—";
}

export function formatarData(data: Date | null | undefined): string {
  return data ? FORMATO_DATA.format(data) : "—";
}
