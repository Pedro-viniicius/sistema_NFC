# Templates de impressão

Um **template de impressão** é a arte final do cartão em PDF — cores, tipografia, logotipos, ícone de NFC,
textos e um **espaço em branco para o QR Code** — enviada pelo painel. O sistema não cria nem altera a arte:

```
PDF DO TEMPLATE (enviado pelo painel)  +  QR ÚNICO (URL permanente do cartão)  =  PDF DE PRODUÇÃO
```

> O sistema preserva o PDF-base e adiciona o QR. A preparação profissional de CMYK, perfil ICC e PDF/X deve ser feita no arquivo-base quando exigida pela gráfica.

O QR contém **sempre a URL permanente do cartão** (a mesma gravada no chip NFC), nunca o destino
(Instagram, Google ou qualquer link do cliente). O template não decide o que vai no QR: quem decide é o cartão.

## Requisitos para quem prepara a arte

- **Uma única página.** Arquivos com mais de uma página são recusados ("O template deve possuir apenas uma
  página."). Os dois lados do cartão podem estar lado a lado na mesma página.
- **Sem rotação de página.** PDFs com a página rotacionada são recusados. Exporte na orientação final.
- **Um espaço em branco para o QR Code.** Só o quadrado do QR (com a margem de silêncio) é desenhado, com fundo
  branco. O restante do espaço reservado continua como está na arte.
- **Fontes incorporadas ou convertidas em curvas.** O arquivo é impresso exatamente como foi enviado.
- **Sangria e marcas, se a gráfica exigir, já no arquivo.** O sistema não acrescenta nem remove sangria.
- **Sem senha, sem scripts, sem ações e sem anexos.** PDFs protegidos ou com conteúdo ativo são recusados.
  A única exceção é o **selo de procedência "Content Credentials" (C2PA)** que ferramentas de criação de imagens,
  inclusive geradores por IA, anexam ao PDF: é só um registro assinado de como a imagem foi feita, e é aceito.
- **Até 25 MB.** A página deve ter entre 20 mm e 2.000 mm de lado.
- Um QR legível pede **pelo menos 15 mm de lado** e módulos de **pelo menos 0,4 mm**. O painel avisa quando a
  área escolhida fica abaixo disso (é um aviso, não um bloqueio).
- **CMYK, perfil ICC e PDF/X** são responsabilidade do arquivo-base (veja a frase em destaque acima).

## Fluxo no painel

Menu **Templates de impressão** (`/admin/templates-impressao`). Tudo exige sessão de administrador.

1. **Novo template → enviar o PDF.** O arquivo é validado no servidor e salvo como **rascunho** na hora. A tela
   mostra o resultado, por exemplo: `PDF válido · cartao_google.pdf · 1 página · 130,05 × 86,70 mm · paisagem`.
2. **Produto e nome.** Produto: Google, Instagram ou Outro link. Nome: por exemplo, "Google — Modelo 01".
3. **Área do QR Code.** Sobre a prévia do PDF, clique em **Posicionar área do QR** e arraste o retângulo para o
   espaço em branco. Os cantos redimensionam; **Manter a proporção** vem ligado. Zoom de 50%, 100%, 150% ou
   **Ajustar à tela**. Os campos **X, Y, Largura e Altura** estão em **mm**, medidos a partir do **canto
   superior esquerdo** da página, e aceitam vírgula (`82,5`). O painel mostra o tamanho do QR e do módulo.
4. **Testar QR.** O servidor gera o PDF final com um QR de teste e mostra a **Prévia de teste**.
   **Baixar PDF de teste** entrega `teste-template-<produto>-<nome>.pdf`: o PDF enviado mais o QR de teste, para
   imprimir em 100% e ler com o celular.
5. **Salvar e ativar.** Só fica disponível depois de um teste bem-sucedido com a configuração atual. O template
   passa a **Pronto**; opcionalmente vira o **padrão** do produto.

O QR de teste aponta para `<domínio>/c/TESTE0`. `TESTE0` é um código **reservado**: tem o mesmo tamanho de um
código real (o QR de teste é idêntico em tamanho aos de produção), mas contém `0`, que não existe no alfabeto dos
códigos. Ele não pode ser gerado nem cadastrado, e `/c/TESTE0` responde "cartão não encontrado", sem redirecionar.
Testar não cria cartão.

No celular, a lista, os dados do template e os downloads funcionam; o editor da área do QR é substituído pelo
aviso "A configuração precisa da área do QR é recomendada em uma tela maior."

### Usar o template

- **Novo lote:** ao escolher o produto, o formulário sugere o template **padrão** e lista os demais templates
  **prontos** do mesmo produto. O servidor recusa rascunhos, inativos e templates de outro produto.
- **Página do lote:** mostra "Template usado: …" e os botões **Baixar pacote para gráfica** (ZIP),
  **Baixar PDF do lote**, **Baixar CSV** e **Visualizar template**.
- **Página do cartão:** **Baixar arte para impressão** entrega `<produto>-<CODIGO>.pdf` (ex.: `google-K8M4T2.pdf`).

| Arquivo | Nome | Conteúdo |
|---|---|---|
| PDF individual | `google-K8M4T2.pdf` | A página do template com o QR do cartão |
| PDF do lote | `lote-google-2026-001.pdf` | Uma página por cartão (sem imposição em folha: isso é com a gráfica) |
| Controle | `lote-google-2026-001-controle.csv` | `numero,codigo,tipo,template,url_permanente,url_nfc,url_qr,arquivo_pdf,arquivo_qr` |
| Pacote | `lote-google-2026-001.zip` | PDF do lote, `controle.csv`, `LEIA-ME.txt`, `qr/*.svg` e `individuais/*.pdf` |

`url_nfc`, `url_qr` e `url_permanente` são sempre iguais. Os PDFs individuais só entram no ZIP enquanto a soma
deles fica abaixo de 40 MB (cada um carrega a arte inteira); acima disso o pacote sai sem a pasta `individuais/`
e o `LEIA-ME.txt` avisa. O PDF do lote tem as mesmas páginas.

## Convenção de coordenadas

A **fonte de verdade são pontos do PDF** no espaço do usuário da página. Só pontos vão para o banco
(`qr_x_pt`, `qr_y_pt`, `qr_largura_pt`, `qr_altura_pt`); pixels, zoom e densidade de tela existem só no navegador.

| | Origem | Unidade |
|---|---|---|
| PDF | canto **inferior** esquerdo | ponto (1 pt = 25,4 / 72 mm) |
| Prévia (pdf.js) | canto **superior** esquerdo | px de CSS |
| Campos do painel | canto **superior** esquerdo da página visível | mm |

- As caixas da página podem não começar em (0, 0). O código usa sempre os valores reais da caixa.
- A prévia mostra a **página visível**: a CropBox limitada à MediaBox (o `page.view` do pdf.js).
- Com `s = largura exibida em px de CSS ÷ (vx1 − vx0)`, um retângulo da prévia (`esquerda`, `topo`, `largura`,
  `altura`) vira:

  ```
  xPt = vx0 + esquerda / s
  yPt = vy1 − (topo + altura) / s      ← borda de baixo, no espaço do PDF
  larguraPt = largura / s
  alturaPt  = altura / s
  ```

- As funções ficam em `src/modules/templates/coordenadas.ts` (`mmToPt`, `ptToMm`, `previewToPdfCoordinates`,
  `pdfToPreviewCoordinates`, `validateQrArea`) e são as mesmas no servidor e no editor. Os testes garantem erro de
  ida e volta de no máximo 0,01 mm em qualquer zoom.

### Como o QR é desenhado

- O QR é o **maior quadrado que cabe na área**, centralizado nela. A **margem de silêncio** (4 módulos por padrão,
  mínimo 2) fica **dentro** do quadrado, então os módulos não encostam em molduras ao redor do espaço reservado.
- Fundo branco só no quadrado do QR. Módulos **vetoriais em 100% K** (`DeviceCMYK 0 0 0 1`), em **um único
  preenchimento**, com módulos vizinhos unidos e sem traços (não aparecem emendas finas entre módulos).
- Correção de erro nível **M**, a mesma de todos os QR do sistema.
- A arte é isolada com `q … Q` antes de o QR ser desenhado, inclusive quando ela própria deixa estados gráficos
  abertos. Uma transformação ou um recorte "esquecido" na arte não desloca nem corta o QR.
- **A página de saída é a página do template:** mesmas MediaBox, CropBox, TrimBox e BleedBox, mesma orientação e
  os mesmos objetos de conteúdo, imagem e fonte, byte a byte. Nada é redimensionado, recolorido, recomprimido ou
  rasterizado. Metadados do arquivo não são alterados.
- As anotações da página (links, campos de formulário) não são copiadas para as páginas de saída.

## Armazenamento

- Os PDFs ficam no **Vercel Blob, com acesso privado** (store `sistema-nfc-templates`, região `gru1`). O banco
  guarda só os metadados e a chave do arquivo. Nada é gravado no disco da Vercel.
- **O PDF não passa por uma função.** Funções da Vercel aceitam requisições de até 4,5 MB, e um template pode ter
  25 MB. O navegador envia o arquivo **direto para o Blob** (`upload()` de `@vercel/blob/client`), com um token de
  curta duração emitido por `POST /api/templates-impressao/upload` só para administradores — só PDF, até 25 MB,
  com sufixo aleatório no nome e sem sobrescrever.
- Em seguida o navegador chama `POST /api/templates-impressao/confirmar`, que **baixa o arquivo, faz a validação
  completa e cria o rascunho**. Se o arquivo não servir, ele é **apagado do Blob** e o motivo é devolvido. O aviso
  `onUploadCompleted` do Blob não é usado (ele não chega em localhost).
- O arquivo só sai do Blob pelas rotas do painel, que conferem a sessão. A URL do Blob nunca é exposta.
- **Um arquivo armazenado nunca é sobrescrito.** Trocar a arte de um rascunho grava outro arquivo e apaga o antigo.
  Excluir um template apaga o arquivo. Não ficam arquivos órfãos.
- A cada geração o sistema confere o **SHA-256** do arquivo com o registrado (e com o que o lote guardou).
- Interface em `src/modules/storage`: `salvar`, `ler`, `excluir`, `existe`. Implementações: Vercel Blob
  (produção), memória (testes) e disco local (**só desenvolvimento**; recusa-se a funcionar na Vercel).

### Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel (criada ao conectar o Blob store) | Acesso ao Vercel Blob |
| `ARMAZENAMENTO_LOCAL=1` | Só na máquina de desenvolvimento | Usar o disco local com o build de produção (`pnpm start`) |

## Versionamento e histórico

| Status | Significado |
|---|---|
| **Rascunho** | Em preparação. Não pode ser usado em lotes. |
| **Pronto** | Tem produto, área do QR e um teste válido. Pode ser usado em lotes novos e ser o padrão do produto. |
| **Inativo** | Não aparece para lotes **novos**. Lotes antigos continuam usando-o. |

- **Um padrão por produto**, garantido no banco (índice único parcial), e só um template pronto pode ser padrão.
- **Mudar a área do QR** de um template não bloqueado invalida o teste e o devolve a rascunho.
- **Bloqueio:** quando um lote é criado com o template, o **arquivo** e a **área do QR** não mudam mais. Continua
  possível renomear, definir ou retirar o padrão e inativar.
- **Duplicar como nova versão** cria um rascunho (ex.: "Google — Modelo 02") com a mesma arte e a mesma área do
  QR. A nova versão pode receber outro arquivo e outra posição.
- **Excluir** só aparece enquanto nenhum lote usa o template. Depois disso, o caminho é inativar.
- **O lote fica preso ao template com que foi criado** (`lotes.template_id` + `lotes.template_sha256`).

  Exemplo: o "Lote Google 001" foi criado com "Google — Modelo 01". Mesmo depois que "Google — Modelo 02" vira o
  padrão e o Modelo 01 é inativado, o Lote 001 continua apontando para o Modelo 01 e regenera arquivos idênticos.

- Apagar um lote libera o template se nenhum outro lote o usar.
- **Lotes anteriores aos templates** (`template_id` nulo) seguem pelo caminho antigo, sem mudança: modelo do
  sistema de 86 × 54 mm, tela **Artes** e os mesmos nomes de arquivo e colunas de antes.

## Limites conhecidos

| Limite | Valor |
|---|---|
| Tamanho do PDF do template | 25 MB (`MAX_TEMPLATE_BYTES`) |
| Cartões por PDF e por lote | 1.000 (`MAXIMO_DE_CARTOES_POR_PDF`) |
| Soma dos PDFs individuais no ZIP | 40 MB |
| Duração máxima das rotas de PDF | 60 s (`maxDuration`) |

Medições (`pnpm templates:medir`, Node 22, máquina de desenvolvimento):

| Template | Cartões | Tempo | PDF gerado | Memória do processo |
|---|---|---|---|---|
| 0,01 MB | 100 | 0,09 s | 0,11 MB | 113 MB |
| 0,01 MB | 1.000 | 0,63 s | 1,02 MB | 116 MB |
| 5 MB | 1.000 | 0,64 s | 6,02 MB | 177 MB |
| 25 MB | 100 | 0,10 s | 25,10 MB | 278 MB |
| 25 MB | 1.000 | 0,65 s | 26,01 MB | 353 MB |

Cada página acrescenta cerca de **1 KB** ao arquivo: a arte entra uma única vez e é compartilhada por todas as
páginas. Na Vercel, respostas em fluxo de 6, 12 e 26 MB foram entregues inteiras (26 MB em 3,4 s).

Fora do escopo desta versão:

- detecção automática do espaço do QR (o administrador indica a área uma vez);
- templates de várias páginas, separação de painéis e imposição em folha;
- conversão para CMYK, perfis ICC e certificação PDF/X;
- mais de um QR por template, textos variáveis e código legível impresso (os lotes antigos, sem template,
  continuam imprimindo o código como antes);
- páginas com rotação.

A prévia no painel é feita com pdf.js e serve para **posicionar** o QR. Fontes não incorporadas podem aparecer
com outra letra na prévia; o arquivo de produção não passa pelo pdf.js e sai sempre com a arte original.

**Conferência humana obrigatória antes de produzir:** imprimir o PDF de teste em 100% e ler o QR com um celular.
Os testes automatizados leem o QR a partir da página renderizada, mas não substituem a impressão real.
