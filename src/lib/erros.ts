export type CodigoDeErro =
  | "CODIGO_INVALIDO"
  | "CODIGO_DUPLICADO"
  | "CARTAO_NAO_ENCONTRADO"
  | "DESTINO_INVALIDO"
  | "TRANSICAO_INVALIDA"
  | "ENTRADA_INVALIDA"
  | "LOTE_NAO_ENCONTRADO"
  | "MODELO_NAO_ENCONTRADO"
  | "IMPRESSAO_INVALIDA"
  | "TEMPLATE_INVALIDO"
  | "TEMPLATE_NAO_ENCONTRADO"
  | "TEMPLATE_BLOQUEADO";

/** Erro esperado de regra de negócio. A mensagem é segura para exibir ao administrador. */
export class ErroDeDominio extends Error {
  constructor(
    public readonly codigo: CodigoDeErro,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeDominio";
  }
}
