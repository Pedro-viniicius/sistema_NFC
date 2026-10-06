import Link from "next/link";
import { notFound } from "next/navigation";
import { obterBanco } from "@/db/cliente";
import { Painel, SeloDeStatus, TituloDaPagina, classesDoBotao, rotuloDoTipo } from "@/components/ui";
import { formatarDataHora } from "@/lib/datas";
import { ErroDeDominio } from "@/lib/erros";
import { pendenciasDaConfiguracao } from "@/modules/activation/configuracao";
import { ehTipoComAtivacao } from "@/modules/activation/link";
import { exigirAdmin } from "@/modules/auth/sessao";
import { buscarLotePorIdentificador } from "@/modules/batches/servico";
import { listarCartoesDoLote } from "@/modules/cards/repositorio";
import { getCardPublicUrl } from "@/modules/cards/url-publica";
import { contarContatosDoLote } from "@/modules/contacts/servico";
import { formatarDimensoesMm } from "@/modules/templates/formato";
import { buscarTemplateDoLote } from "@/modules/templates/producao";
import { ApagarLote } from "./apagar-lote";
import { AtivacaoPeloCliente } from "./ativacao-pelo-cliente";

export default async function PaginaDoLote({ params }: PageProps<"/admin/lotes/[identificador]">) {
  await exigirAdmin();
  const { identificador } = await params;
  const db = obterBanco();

  const lote = await buscarLotePorIdentificador(db, identificador).catch((erro: unknown) => {
    if (erro instanceof ErroDeDominio) return null;
    throw erro;
  });
  if (!lote) notFound();

  const cartoes = await listarCartoesDoLote(db, lote.id);
  const exportar = `/admin/lotes/${lote.identificador}/exportar`;
  // Lotes gerados com um template de impressão ficam presos a ele; os demais usam o modelo do sistema.
  const template = await buscarTemplateDoLote(db, lote);
  const baixar = `/admin/lotes/${lote.identificador}/grafica/baixar`;

  // Ativação pelo cliente: quantos cartões já estão ativados e por que a opção pode estar indisponível.
  const ativados = cartoes.filter((cartao) => cartao.status === "ATIVO").length;
  const ativadosPeloCliente = await contarContatosDoLote(db, lote.identificador);
  const pendencias = pendenciasDaConfiguracao();
  const impedimento = !ehTipoComAtivacao(lote.tipo)
    ? "A ativação pelo cliente só existe para lotes de Instagram ou de Google."
    : pendencias.length > 0
      ? `Antes de ligar, configure na Vercel: ${pendencias.join("; ")}.`
      : null;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/lotes" className="text-slate-500 hover:text-slate-900">
          ← Lotes
        </Link>
      </p>
      <TituloDaPagina titulo={lote.identificador}>
        {template ? null : (
          <Link href={`/admin/lotes/${lote.identificador}/grafica`} className={classesDoBotao("primario")}>
            Gerar arquivos para gráfica
          </Link>
        )}
        <a href={`${exportar}?formato=zip`} className={classesDoBotao("secundario")}>
          Baixar QR Codes (ZIP)
        </a>
        <a href={`${exportar}?formato=csv`} className={classesDoBotao("secundario")}>
          Exportar CSV
        </a>
      </TituloDaPagina>

      <p className="mb-4 text-sm text-slate-600">
        {cartoes.length.toLocaleString("pt-BR")} {cartoes.length === 1 ? "cartão" : "cartões"} ·{" "}
        {lote.tipo ? rotuloDoTipo(lote.tipo) : "Sem tipo definido"} · criado em {formatarDataHora(lote.criadoEm)}
        {lote.descricao ? ` · ${lote.descricao}` : ""}
      </p>
      {template ? (
        <div id="grafica" className="mb-4 scroll-mt-6">
          <Painel titulo="Arquivos para a gráfica">
            <p className="text-sm text-slate-700">
              Template usado: <strong className="text-slate-900">{template.nome}</strong>
              <span className="text-slate-500">
                {" "}
                · {formatarDimensoesMm(template.larguraDaPaginaMm, template.alturaDaPaginaMm)}
                {template.status === "INATIVO" ? " · inativo para novos lotes" : ""}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Este lote é sempre gerado com este template, mesmo que outro vire o padrão do produto. Cada página do PDF
              é a arte original com o QR Code de um cartão.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`${baixar}?arquivo=zip`} className={classesDoBotao("primario")}>
                Baixar pacote para gráfica
              </a>
              <a href={`${baixar}?arquivo=pdf`} className={classesDoBotao("secundario")}>
                Baixar PDF do lote
              </a>
              <a href={`${baixar}?arquivo=csv`} className={classesDoBotao("secundario")}>
                Baixar CSV
              </a>
              <Link href={`/admin/templates-impressao/${template.id}`} className={classesDoBotao("secundario")}>
                Visualizar template
              </Link>
            </div>
          </Painel>
        </div>
      ) : (
        <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Em <strong>Gerar arquivos para gráfica</strong> você baixa a arte final de cada cartão (PDF), o controle de
          produção e os QR Codes. O ZIP de QR Codes daqui contém só os SVGs e o{" "}
          <code className="font-mono">lote.csv</code>.
        </p>
      )}

      <div className="mb-4">
        <Painel
          titulo="Ativação pelo cliente"
          descricao="Com a opção ligada, quem abrir um cartão ainda não ativado deste lote (pelo QR Code ou pelo NFC) vê o passo a passo para ativá-lo sozinho e deixa os dados de contato."
        >
          <AtivacaoPeloCliente
            identificador={lote.identificador}
            ligada={lote.ativacaoPeloCliente}
            impedimento={impedimento}
          />
          <p className="mt-4 text-sm text-slate-700">
            <strong>
              {ativados.toLocaleString("pt-BR")} de {cartoes.length.toLocaleString("pt-BR")}
            </strong>{" "}
            {cartoes.length === 1 ? "cartão ativado" : "cartões ativados"}
            {ativadosPeloCliente > 0 ? (
              <>
                {" · "}
                <Link
                  href={`/admin/contatos?lote=${lote.identificador}`}
                  className="font-medium underline underline-offset-2"
                >
                  {ativadosPeloCliente} pelo próprio cliente
                </Link>
              </>
            ) : null}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Ligue só quando os cartões estiverem saindo para entrega: enquanto a opção estiver ligada, quem tiver um
            cartão em mãos pode ativá-lo. Você continua podendo ativar e trocar o link de qualquer cartão pelo painel.
          </p>
        </Painel>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">URL permanente</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cartoes.map((cartao) => (
              <tr key={cartao.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/cartoes/${cartao.codigo}`} className="font-mono font-semibold text-slate-900 hover:underline">
                    {cartao.codigo}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{getCardPublicUrl(cartao.codigo)}</td>
                <td className="px-4 py-2.5 text-slate-700">{rotuloDoTipo(cartao.tipo)}</td>
                <td className="px-4 py-2.5">
                  <SeloDeStatus status={cartao.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Painel
          titulo="Apagar lote"
          descricao="Remove o lote e todos os cartões dele. Use para lotes de teste ou gerados por engano."
        >
          <ApagarLote
            identificador={lote.identificador}
            total={cartoes.length}
            configurados={cartoes.filter((cartao) => cartao.destinoUrl !== null).length}
            comAcessos={cartoes.filter((cartao) => cartao.totalAcessos > 0).length}
          />
        </Painel>
      </div>
    </>
  );
}
