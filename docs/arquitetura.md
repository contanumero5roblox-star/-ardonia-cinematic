# Arquitetura e decisões técnicas

## Aplicação estática

O projeto usa TypeScript, HTML e CSS com Vite e o pacote oficial `@owlbear-rodeo/sdk` 3.1.0. O SDK é empacotado no build, sem depender de um CDN durante a sessão. Não há backend próprio, banco remoto ou login adicional. A extensão mantém um controlador de áudio persistente no background de cada participante; somente o painel oferece controles; os modais enviam sinais de renderização/fechamento, sem recriar o contexto a cada anúncio. Preferências individuais são locais e distintas da prontidão real do contexto.

Há três entradas: `index.html` para o painel, `background.html` para o receptor da sala e `presentation.html` para a apresentação. O manifesto v1 registra a ação e o background. URLs precisam preservar o prefixo `/-ardonia-cinematic/` na hospedagem Pages.

## Biblioteca privada e imagens

O mestre gerencia registros com `id`, `title`, `description`, `imageUrl`, `durationSeconds`, `updatedAt` e um efeito sonoro opcional. A biblioteca usa uma chave própria de `localStorage`, sem publicar a coleção em metadados da sala ou da cena. Cada navegador e origem possui sua coleção; não há sincronização ou promessa de recuperação sem backup. Fora do Owlbear, o editor e a prévia local continuam disponíveis; anúncios para a sala ficam desativados.

Entradas e backups são validados em tempo de execução. Títulos têm até 180 caracteres, descrições 6.000 e URLs 2.048; o backup aceita até 500 cenas e 2 MiB. São limites do aplicativo, não uma afirmação de quota oficial do SDK. URLs de imagem precisam usar HTTPS e não podem conter credenciais. Texto de usuário entra no DOM como texto. Falhas de quota, bloqueio ou corrupção do armazenamento são informadas sem sobrescrever silenciosamente a biblioteca.

A importação mescla cenas por ID, mantendo os registros restantes. Se houver IDs em conflito, a interface solicita confirmação antes de substituir as cenas correspondentes. Arquivos inválidos são rejeitados antes da gravação.

A imagem é carregada diretamente pelo navegador de cada participante. O botão **Escolher no Owlbear** usa `OBR.assets.downloadImages(false)`; a URL retornada passa pela mesma validação das URLs digitadas. Isso não garante que recursos privados, links assinados ou URLs temporárias continuarão acessíveis a todos ou em sessões futuras. A opção principal é uma URL HTTPS pública e durável. Não há upload para um servidor próprio.

Proteção contra hotlink, indisponibilidade e permissões do host podem impedir uma imagem. O cliente mostra fallback sem impedir título e descrição. O backup salva URLs, não os arquivos de imagem.

## Como o anúncio chega aos jogadores

1. O painel confirma pelo SDK que o usuário é GM e valida a cena.
2. Cria um evento com identificador único e dados somente da cena escolhida.
3. `OBR.broadcast.sendMessage` envia o evento com destino `ALL`, incluindo o próprio cliente.
4. O receptor de cada cliente registra `OBR.broadcast.onMessage` após `OBR.onReady`, mesmo com o painel fechado.
5. O receptor relaciona o `connectionId` fornecido pelo SDK ao usuário local ou a `OBR.party.getPlayers()` e verifica o papel **GM**. Um papel declarado dentro do payload não serviria como autorização.
6. Valida o payload, descarta repetições e organiza a substituição de apresentações para evitar operações `close/open` sobrepostas. O anúncio mais recente substitui o anterior.
7. Abre um modal **local**, com `fullScreen: true` e `hidePaper: true`, usando uma URL da própria extensão. A URL carrega apenas o ID do evento, sem título, descrição ou URL de imagem.
8. O modal registra seu receptor e faz um handshake pelo broadcast `LOCAL`. O background responde somente ao ID ativo e à conexão local. Os dados ficam em memória, sem gravar apresentações recebidas na biblioteca ou em armazenamento persistente.
9. O modal inicia a contagem ao renderizar a cena. O prazo efetivo pertence a esse evento neste cliente. O handshake local também permite recuperar o prazo original quando o iframe é recarregado.

Abrir um modal no mestre não o abre nos demais clientes. O broadcast seguido da abertura local em cada background torna esse fluxo multiplayer. O sucesso de envio pelo SDK não é um recibo de leitura ou exibição de todos os participantes.

O normalizador do SDK resolve certos caminhos a partir da origem, sem o subdiretório. Por isso, a URL absoluta do modal é construída a partir da URL da extensão, preservando o nome do repositório no Pages. As APIs de sala usadas aqui não dependem de uma cena carregada; não é necessário bloquear o anúncio esperando `scene.isReady`.

## Duplicação, ordem e limites

O envelope do anúncio é limitado pelo aplicativo a 15.000 bytes UTF-8. Esse limite conservador não é apresentado como quota oficial do serviço. Eventos com mais de dois minutos ou relógio mais de dois minutos no futuro são recusados; mantenha o relógio dos participantes correto.

Além do controle por ID, o background verifica a bridge existente da mesma implantação antes de criar um controlador ou registrar receptores. Assim dois iframes de background no mesmo cliente não criam duas cadeias de áudio independentes. Testes no painel dentro da sala exigem esse proprietário; não há reprodutor local alternativo competindo com os anúncios.

IDs únicos permitem descartar um evento repetido. A memória conserva até 256 IDs e a última cena aceita; eventos anteriores também são descartados pelo timestamp. A troca de modais é serializada, e anúncios recentes substituem os anteriores. Não se pretende reproduzir toda uma rajada como uma fila de cenas antigas: isso atrapalharia o uso durante a sessão.

O broadcast é transitório. Clientes desconectados, em reconexão, sem a extensão ativa ou com o navegador suspenso podem perder o evento. Não há histórico de anúncios ou reenvio para quem chega depois. O mestre pode anunciar novamente; uma nova ação cria outro ID e é aceita normalmente.

Os dados são validados antes do envio e novamente na recepção. O papel é verificado pelo estado da sala disponível ao SDK. Alterações concorrentes de papel ou conexão podem fazer um evento ser rejeitado de forma conservadora. Não há contorno que confie na declaração do remetente dentro do payload.

A API de modais não oferece callback de fechamento. Se o iframe não obtiver a cena dentro do prazo de seis segundos, ele solicita o fechamento do próprio ID. No encerramento normal ou por falha, se o documento ainda estiver presente após um segundo, ele repete o pedido uma única vez. Se continuar montado por mais um segundo, mostra **Tentar fechar novamente**. Caso o host pare de responder por completo, a mensagem orienta a recarregar a sala.

## Interface e dispositivos móveis

O anúncio contém somente imagem, título e descrição opcional. Fundo escuro, escala tipográfica adaptável e animação discreta dão destaque à cena. A imagem usa contenção para não se deformar. Conteúdo extenso continua acessível por rolagem vertical; a interface evita rolagem horizontal e respeita áreas seguras da tela.

O editor limita a duração a 8, 10, 12, 14, 16 ou 20 segundos. O padrão de 14 segundos também se aplica à biblioteca e aos backups antigos. A prévia continua disponível para leitura com X ou Esc. O anúncio escurece nos dois segundos finais e solicita `OBR.modal.close` com o ID exclusivo do evento. A troca de cenas, uma retentativa ou um callback atrasado só pode fechar o ID a que se refere.

A API controla o modal e o backdrop do host. O fade acontece no conteúdo do iframe sobre o fundo escuro da extensão. A liberação do mapa depende do fechamento do modal pelo Owlbear. Se a aba estiver suspensa, o cliente volta a verificar o prazo assim que puder executar JavaScript. `prefers-reduced-motion` reduz ou remove animações. O efeito curto é independente do visual. Restrições de autoplay não impedem a cena; a ativação e todos os avisos de áudio ficam em Som de entrada no painel, sem qualquer controle de som no modal. Não há trilhas/loops nem auto-fechamento ao terminar o som. Consulte [decisões de áudio](audio.md).

Testes por viewport são evidência de layout, não certificação de Safari/iOS, Chrome/Android ou aparelhos modestos. Os testes necessários em sala e em dispositivos físicos estão no [relatório de validação](validacao.md).

## Fontes oficiais consultadas

O domínio editorial `docs.owlbear.rodeo` retornou 403 pelo proxy. Foram lidos os tipos e o código publicado no repositório oficial, além do pacote npm 3.1.0:

- [BroadcastApi](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/BroadcastApi.ts).
- [PlayerApi](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/PlayerApi.ts) e [Player](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/Player.ts).
- [PartyApi](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/PartyApi.ts).
- [ModalApi](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/ModalApi.ts) e [Modal](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/Modal.ts).
- [Normalização de URLs](https://github.com/owlbear-rodeo/sdk/blob/main/src/common/normalize.ts).
- [AssetsApi](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/AssetsApi.ts).
- [Manifesto de exemplo oficial](https://github.com/owlbear-rodeo/sdk-tutorials/blob/main/hello-world/public/manifest.json).
- [Licença do SDK](https://github.com/owlbear-rodeo/sdk/blob/main/LICENSE).

Os testes locais usam dublês do transporte SDK e não substituem uma sessão real.
