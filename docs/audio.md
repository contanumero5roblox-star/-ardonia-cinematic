# Efeitos de entrada — versão 1.1.2

## Ativar e controlar o próprio som

A versão 1.1.2 preserva a ativação persistente introduzida na 1.1.1, limpa a apresentação e impede proprietários concorrentes da mesma implantação. Agora existe **um controlador persistente no background de cada participante**, com o mesmo AudioContext e cache de efeitos durante a sessão.

1. Abra **Som de entrada** no painel como mestre ou jogador.
2. Clique em **Ativar som** uma vez nesta sessão. O clique chama o controlador persistente sincronamente e solicita `AudioContext.resume()` antes de qualquer espera ou mensagem assíncrona.
3. Aguarde o teste de confirmação e o indicador **Pronto nesta sessão**. Esse estado exige confirmação real de contexto em execução; salvar uma preferência não basta.
4. Pode fechar o painel. Os anúncios seguintes usam o mesmo controlador e contexto, inclusive depois de fechar as apresentações.

**Volume** continua individual. **Testar efeito** usa o controlador persistente e pode tocar um teste manual mesmo com anúncios silenciados. **Desativar som** interrompe o efeito em execução e evita os próximos. A preferência salva é intenção do usuário; ao entrar novamente numa sala, recarregar ou reiniciar o background, pode ser necessário ativar de novo. O indicador só afirma prontidão enquanto o contexto verificado estiver em execução.

A interface chama uma bridge JavaScript própria, síncrona e de mesma origem, no background acessível da extensão. Não é uma mensagem de broadcast tentando transportar o gesto. O navegador pode permitir ou negar a chamada entre frames; o código verifica o resultado real. A busca pela bridge usa somente referências WindowProxy permitidas, filtra o diretório de implantação e não lê o DOM do Owlbear. Se o host isolar os frames ou bloquear o contexto, não será exibida uma autorização falsa.

No Chromium testado, o clique/toque permitiu ativar o background, inclusive sob um pai de outra origem, e o contexto continuou funcionando depois de expirar a ativação transitória. Essa propagação entre frames de mesma origem é comportamento documentado do Chromium e não uma garantia universal do padrão HTML. Firefox, Safari/iOS, políticas do host e versões futuras podem se comportar de outra forma.

Se houver bloqueio, a cena continua normalmente, **sem controles ou mensagens de áudio**. Abra **Som de entrada** no painel para ver o estado, conferir as permissões de som/autoplay do site e tentar **Ativar som** novamente. Não há mais reprodução manual nem contexto de áudio dentro do modal. Se o controlador da sala estiver inacessível, o painel não inicia um segundo reprodutor local; informe-se pelo aviso e recarregue a sala. Fora do Owlbear, o editor pode continuar testando efeitos localmente, sem anúncios multiplayer.

A cinematic contém somente a imagem, o título, a descrição opcional e o X no canto superior direito. O X e Esc continuam fechando a apresentação; o término do efeito não a fecha.

As preferências são salvas neste navegador/origem quando permitido, sem enviá-las aos outros participantes. Se armazenamento de terceiros estiver bloqueado, o background conserva a escolha em memória durante a sessão. Um painel reaberto lê o estado vivo do controlador. Falhas de gravação são informadas. Fechar o painel não descarta o controlador; sair/recarregar a sala ou desabilitar a extensão pode descartá-lo.

Não há garantia de autoplay universal, principalmente no iOS. O navegador pode suspender áudio quando a aba/aplicativo fica em segundo plano; mantenha a sala ativa. Nenhuma flag para desativar políticas de autoplay é usada pelo produto.

## Escolher os efeitos da campanha

No painel do mestre, dentro de **Som de entrada**, escolha **Efeito geral dos anúncios**:

- **Impacto padrão**: efeito original do Ardonia.
- **Áudio por URL HTTPS**: endereço direto de um áudio público.
- **Sem efeito sonoro**: anúncios silenciosos.

Use **Testar efeito** antes de **Salvar efeito geral**. **Voltar ao efeito padrão** restaura o impacto original. Essa seleção fica neste navegador do mestre; cada anúncio transmite somente a escolha efetiva, por isso todos os participantes recebem o mesmo efeito escolhido. Volume e ativação permanecem individuais.

No editor de uma cinematic, **Efeito de entrada desta cinematic** permite herdar o efeito geral, usar o original, definir outra URL ou anunciar sem efeito. A opção específica tem prioridade sobre o efeito geral. **Testar efeito da cinematic** usa a escolha efetiva e o volume local. O botão de prévia visual mantém sua função visual; testar o som é uma ação separada e explícita.

Backups antigos continuam válidos e herdam o efeito geral. O backup da biblioteca preserva as escolhas específicas de cada cinematic. O efeito geral do mestre e as preferências individuais ficam fora do backup da biblioteca; configure-os novamente ao trocar de navegador/origem.

## URLs, arquivos e limites

Aceitam-se áudios que o decoder do navegador suporte, incluindo MP3, PCM WAV e OGG compatível. MP3/WAV são as opções mais amplamente suportadas; OGG depende do codec e da versão do navegador. A extensão do nome não garante decodificação. Arquivos inválidos ou incompatíveis produzem uma mensagem e não impedem a cena.

Limites do aplicativo:

- Endereço completo **HTTPS**, até 2.048 caracteres, sem credenciais na URL. `data:`, `blob:` e caminhos de arquivo local não são aceitos. Apenas o mesmo HTTP loopback é permitido durante desenvolvimento local.
- Recurso público sem login, cookies ou cabeçalhos de autenticação.
- **CORS permitido**: use, por exemplo, `Access-Control-Allow-Origin: *` no host do áudio. O carregamento usa fetch sem cookies/referrer e Web Audio para validar tamanho/duração.
- Até **1 MiB transferido** e **cinco segundos decodificados**. Leituras em streaming têm limite efetivo; o tamanho declarado também é verificado. A duração é validada antes de agendar o som.
- Carga/decodificação com prazo de seis segundos. A tentativa automática na entrada tem um orçamento menor, de **1,5 segundo**: se não estiver pronta, é cancelada para evitar tocar subitamente muito depois da cena. O botão explícito pode tentar novamente.

Não há serviço de upload no Ardonia. Selecionar um arquivo local não o torna acessível aos jogadores. Para usar um arquivo seu, hospede-o em HTTPS público com CORS e cole a URL. Na hospedagem estática deste projeto, uma opção é adicionar um arquivo autorizado em `public/sounds/`, recompilar e republicar; depois use sua URL pública. Nenhum arquivo, base64 ou blob é transmitido pelo broadcast: somente a URL/configuração pequena. Não coloque credenciais no endereço.

O mestre deve ter autorização para usar e compartilhar o efeito personalizado. Arquivos em servidores externos podem ser removidos, expirar ou ficar inacessíveis. Testar no navegador do mestre não prova acesso de cada jogador.

## Reprodução, sincronização e duração

O background recebe o anúncio autenticado, prepara o efeito sem aguardar a carga e abre o modal. Depois que a cena é renderizada, o modal envia `AUDIO_RENDERED` por broadcast LOCAL. O background confere conexão local e ID ativo, marca a tentativa antes de esperar e toca uma única fonte. Somente o painel oferece controles. O modal sinaliza renderização e fechamento ao proprietário, sem criar contexto, botões ou status de áudio.

Fechar a apresentação envia STOP do evento e cancela a fonte/agendamento, **sem fechar o AudioContext persistente**. Um STOP antigo não cancela a cena seguinte. Um novo anúncio cancela o efeito anterior antes de esperar o fechamento visual. O controlador só é descartado ao encerrar seu próprio background. Um segundo background da mesma implantação não registra outro receptor nem cria outro controlador. Isso impede que o mesmo anúncio seja reproduzido em paralelo por dois proprietários.

A cena é renderizada antes da tentativa de áudio e não aguarda download, desbloqueio ou decoder. A reprodução começa assim que o contexto e o buffer estiverem prontos dentro do orçamento de entrada. Não há sincronização exata de relógio entre dispositivos: rede, decodificação, políticas e dispositivos de saída introduzem diferenças. Um efeito bloqueado só será ouvido posteriormente se o participante pedir explicitamente.

A deduplicação existente do `eventId` e o controlador persistente impedem repetição de eventos/handshakes. Uma execução aceita cria uma fonte Web Audio sem loop. Após tocar, desligar e religar não repete o anúncio consumido. Fechar, silenciar ou substituir cancela a fonte e o agendamento pendente. Uma resolução tardia de `resume()` ou download não dispara um anúncio cancelado.

O efeito terminar **não fecha a apresentação**. Ela continua aberta até ser fechada pelo participante ou substituída por outro anúncio, como antes. Não há música de fundo nem reprodução contínua.

## Origem do efeito padrão e investigação da referência

`public/sounds/impact.wav` é uma síntese original determinística de 0,95 segundo, mono PCM16 a 22.050 Hz, com 41.940 bytes. `scripts/generate-impact.py` documenta e reproduz a síntese: grave descendente, harmônicos, transiente de ruído e ecos finitos. Nenhum sample externo foi usado. O efeito e seu gerador seguem a licença MIT deste projeto. Os pequenos MP3/OGG de teste derivam dessa mesma síntese original, codificados por FFmpeg; não são usados como trilhas do aplicativo.

A referência foi relida em 14/11/2026: o botão toca um Audio no painel; o background tenta tocar antes do modal e envia uma flag para o modal tentar somente se a primeira tentativa falhou. Esse arranjo não garante a autorização de outro iframe e pode atrasar o visual. O Ardonia 1.1.2 usa um background persistente, ativação verificada no próprio proprietário e reprodução após renderizar a apresentação, sem copiar o código nem o áudio da referência.

O `anuncio.mp3` original tem 90.950 bytes e metadado de encoder `Lavf60.12.101`; isso não identifica uma licença de reutilização. Não foi encontrada licença explícita no repositório/arquivo. O MP3 da referência não foi copiado, reproduzido ou distribuído.

Fontes consultadas por leitura HTTP:

- [Painel da referência](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/index.html), [background](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/background.html) e [anúncio](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/anuncio.html).
- [Ativação de usuário no Chrome e comportamento entre frames de mesma origem](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/user-activation/index.md).
- [Modelo de ativação do HTML](https://html.spec.whatwg.org/multipage/interaction.html#activation-notification).
- [Política oficial do Chrome](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/autoplay/index.md).
- [Guia de autoplay MDN/Mozilla](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/media/guides/autoplay/index.md).
- [Formatos de áudio MDN](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/media/guides/formats/audio_codecs/index.md).

## Evidência e limitações de teste

As medições e a investigação de sobreposição estão em [validação de volume](volume-validation.md). O efeito padrão e o ganho escolhido não foram reduzidos.

Há testes do motor e controlador persistente com APIs simuladas para bloqueio, cancelamento, limites e ausência de repetição; testes da UI e um teste multiplayer com SDK real e host/agendador simulados. Os testes de codecs usam o decoder real do Chromium para WAV/MP3/OGG.

O teste `persistent-audio.spec.ts` usa **Web Audio e SDK reais do Chromium**, dois clientes independentes (desktop e viewport móvel com toque) e host HTTP de outra origem. Cada participante ativa uma vez por clique/toque real. Após 6,5 segundos, o servidor simulado entrega três anúncios autenticados de GM, com painéis fechados desde o primeiro e fechamento entre apresentações. Há mais 6,5 segundos entre ciclos. Cada cliente mantém **um único AudioContext no background e quatro fontes no total: uma confirmação mais três entradas**, sem contextos nos modais normais. Os três anúncios são agendados com `navigator.userActivation.isActive === false`, contexto em execução e sem loop.

Esse teste não usa flags de liberação de autoplay nem `page.evaluate`/`locator.evaluate` que concedam um gesto artificial. As métricas vêm da instrumentação nativa por binding; comandos de servidor usam CDP com `userGesture:false`. O cenário de clique no botão Anunciar continua coberto pelo teste de SDK com host/agendador simulados. No teste nativo, os anúncios são entregas do servidor simulado, e não cliques numa sala real. O Chromium bloqueou localStorage de terceiros nesse cenário; mantivemos essa política real e verificamos a sessão em memória.

A prova é de chamadas e decodificação no navegador, não de som audível em alto-falantes físicos. Não foi realizado ensaio em sala real do Owlbear, Firefox, Safari/iOS ou Android físico. Depois de republicar, confirme **Pronto nesta sessão**, feche o painel e teste três anúncios com um jogador em outro dispositivo. Veja [validação](validacao.md).
