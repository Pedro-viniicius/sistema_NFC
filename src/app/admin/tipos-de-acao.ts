export type ResultadoDaAcao<T> = { ok: true; dados: T } | { ok: false; erro: string };

export interface EstadoDeFormulario {
  erro?: string;
  sucesso?: string;
  /** Observação que não impede a operação (ex.: arte sem sangria). */
  aviso?: string;
}
