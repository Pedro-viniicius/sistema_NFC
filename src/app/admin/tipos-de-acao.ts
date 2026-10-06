export type ResultadoDaAcao<T> = { ok: true; dados: T } | { ok: false; erro: string };

export interface EstadoDeFormulario {
  erro?: string;
}
