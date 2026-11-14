# Investigação da referência — 14/11/2026

Repositório público: https://github.com/emixiszao/inventario-owlbear
Commit observado na página GitHub: `b08526e637edf2f78c462ab6e0d4303b115ed24d`, branch `main`.
Manifesto solicitado: https://emixiszao.github.io/inventario-owlbear/manifest.json

## Acesso e licença

A hospedagem github.io retornou `Tunnel connection failed: 403 Forbidden` neste ambiente. Foi possível ler os mesmos arquivos no código-fonte via https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/manifest.json, bem como a página pública do repositório. A árvore apresentada pelo GitHub contém exatamente oito arquivos: anuncio.html, anuncio.mp3, background.html, icon.svg, index.html, manifest.json, shared.css, shared.js. Não há arquivo de licença ou README nessa árvore; os caminhos LICENSE, LICENSE.md, LICENSE.txt, COPYING e license retornaram 404. Sem uma licença explícita, a disponibilidade pública não autoriza reutilização do código, imagem, ícone ou áudio. A implementação nova deve ser independente, preservando apenas a ideia e o uso das APIs oficiais.

## Manifesto e SDK

Manifest v1, versão 1.0.0, nome Inventário - Ordem Paranormal, autor @mestremxrpg no Youtube. Declara `background_url` e ação popover 440 × 600, com URLs absolutas para github.io. A permissão clipboard-write é destinada à cópia de texto para um site terceiro e não é necessária ao Ardonia. O código importa `@owlbear-rodeo/sdk@3` de esm.sh; para produção reprodutível convém empacotar o SDK pelo gerenciador de dependências com lockfile.

## Fluxo multiplayer

`index.html` reúne nome, descrição HTML sanitizada, URL da imagem e campos de inventário. Rejeita payload JSON acima de 15.000 bytes e chama `OBR.broadcast.sendMessage(CH_ANUNCIO, dados, { destination: 'ALL' })`.

`background.html` fica carregado nos clientes independentemente do popover. Após `OBR.onReady`, registra `OBR.broadcast.onMessage`. Cada cliente tenta tocar áudio, fecha o modal anterior de ID fixo e abre `OBR.modal.open` com `fullScreen: true`, `hidePaper: true`, URL de `anuncio.html` com dados JSON codificados na query string. Assim o broadcast é que leva cada cliente a abrir seu próprio modal; abrir apenas no mestre seria insuficiente. A prévia abre diretamente o modal do cliente local e não usa broadcast.

Há validação mínima do receptor (apenas existência de nome), sem ID de evento, deduplicação, autenticação do remetente ou serialização das operações close/open. Mensagens repetidas ou callbacks assíncronos sobrepostos podem reabrir/duplicar visualmente a apresentação ou trocar sua ordem. A referência não persiste anúncios para usuários que conectam depois.

## Armazenamento e imagens

Biblioteca do mestre em `localStorage` sob chave `inventario:banco:v1`; permanece no mesmo navegador/origem, sem sincronização entre dispositivos. Há ainda uma lista opcional de itens liberados em `OBR.room` metadata, com guarda conservadora de 15.000 bytes. Essa lista é separada da biblioteca local. O papel GM/Jogador vem de `OBR.player.getRole`, atualizado por `player.onChange`.

Imagens por URL HTTPS, `OBR.assets.downloadImages(false)` para escolher da biblioteca, e `OBR.assets.uploadImages` com `buildImageUpload` para enviar nova imagem. O backup é JSON da lista local; importação mescla IDs não existentes, mas faz pouca validação e não limita tamanho, número de registros ou URLs. Falhas de armazenamento são apenas toast, sem rollback do estado em memória.

## Apresentação visual

Fundo radial quase preto, imagem com altura máxima 42vh sem distorção, título Georgia em caixa alta e tamanho `clamp(22px,3.4vw,38px)`, descrição abaixo e linha separada tipo/categoria/peso. Fade/zoom de entrada de 450 ms, flutuação infinita, efeito holográfico 3D sob ponteiro, lupa opcional, botão de fechar 36px e duração automática de oito segundos pausada pelo ponteiro/lupa. Ardonia deve eliminar integralmente a linha de metadados e todos os campos de inventário; preservar apenas imagem, título e descrição opcional.

## Limitações móveis e acessibilidade observadas no código

Não foram realizados testes em sala real ou em aparelhos reais. Não há issues abertas indicadas no contador público consultado; isso não comprova ausência de bugs. A análise estática identifica riscos:

- Botão 36px é pequeno para toque; sem safe-area para recortes da tela.
- Body overflow:hidden, descrição limitada a 28vh e layout flex centralizado podem cortar títulos extensos em telas baixas/horizontais.
- `touch-action:none` na imagem interfere na rolagem por toque.
- Flutuação infinita, filtros e imagens duplicadas holográficas podem pesar; não há `prefers-reduced-motion`.
- Lupa de 240px pode escapar da tela pequena.
- Auto-fechamento em oito segundos pode impedir leitura de descrições longas; pause por hover não ajuda toque.
- Áudio no background pode ser bloqueado pelo navegador móvel. A tentativa separada de ativá-lo no popover não necessariamente desbloqueia outro iframe. A falha não impede o modal visual.
- Falha de imagem não tem fallback dedicado.
- Não há deduplicação nem fila no receptor.

## Fontes lidas

- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/manifest.json
- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/index.html
- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/background.html
- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/anuncio.html
- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/shared.js
- https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/shared.css
- https://github.com/emixiszao/inventario-owlbear
- https://github.com/emixiszao/inventario-owlbear/issues

As cópias de investigação foram guardadas somente em /tmp/ardonia-reference; não devem ser incluídas no projeto como código reutilizável.

## Verificação da hospedagem GitHub Pages

A documentação oficial foi lida por seu repositório público porque `docs.github.com` não estava acessível neste ambiente:

- [Disponibilidade por plano](https://github.com/github/docs/blob/main/data/reusables/gated-features/pages.md): repositórios privados exigem Pro, Team ou Enterprise; Free contempla repositórios públicos.
- [Visibilidade pública do site](https://github.com/github/docs/blob/main/data/reusables/pages/private_pages_are_public_warning.md): site Pages pode ser público mesmo quando o repositório é privado.
- [Como criar o site](https://github.com/github/docs/blob/main/content/pages/getting-started-with-github-pages/creating-a-github-pages-site.md).
- [Tipos de site e caminhos](https://github.com/github/docs/blob/main/content/pages/getting-started-with-github-pages/what-is-github-pages.md): o site de projeto usa, por padrão, `https://<owner>.github.io/<repository>/`.

Isso estabelece os requisitos do produto, não o plano contratado, permissões administrativas ou estado de publicação da conta do usuário.
