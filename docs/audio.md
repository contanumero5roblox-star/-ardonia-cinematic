# Efeitos de entrada — versão 1.1.0

## Ativar e controlar o próprio som

O som começa desativado para respeitar a escolha de cada participante. Mestre e jogadores abrem **Som de entrada** no painel e clicam em **Ativar som**. Esse clique real toca um teste e tenta habilitar o contexto de áudio do painel. **Volume** ajusta apenas este navegador; **Testar efeito** pode tocar um teste manual mesmo com anúncios silenciados. **Desativar som** interrompe o efeito em execução e evita os próximos.

A preferência de ativação e o volume são salvos neste navegador/origem quando o armazenamento permite. Não são enviados aos outros participantes. Se o armazenamento estiver bloqueado, a interface informa que a escolha vale somente naquele contexto/sessão; pode ser necessário ativar no anúncio novamente.

Autorização do navegador e preferência do aplicativo são coisas diferentes. Um clique no painel não autoriza necessariamente um novo iframe de apresentação. A apresentação tenta tocar na entrada quando a preferência está ativada; se houver bloqueio, continua visível e oferece **Ativar som** dentro do próprio anúncio. O clique nesse botão chama `AudioContext.resume()` diretamente durante a interação e tenta a entrada uma vez. Não há ativação por um clique genérico no fundo.

Alguns navegadores, configurações de privacidade e políticas do iframe podem impedir o áudio mesmo com gesto. Se continuar bloqueado, confira as permissões de som/autoplay do site no navegador. Não há garantia de autoplay universal, especialmente em Safari/iOS. Preferências podem persistir sem que a autorização de reprodução persista.

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

Somente o modal toca o efeito do anúncio; o background continua responsável por receber e abrir a cena, sem reproduzir áudio. O painel toca apenas testes explicitamente solicitados. Assim não há disputa entre uma tentativa no background e outra no modal.

A cena é renderizada antes da tentativa de áudio e não aguarda download, desbloqueio ou decoder. A reprodução começa assim que o contexto e o buffer estiverem prontos dentro do orçamento de entrada. Não há sincronização exata de relógio entre dispositivos: rede, decodificação, políticas e dispositivos de saída introduzem diferenças. Um efeito bloqueado só será ouvido posteriormente se o participante pedir explicitamente.

A deduplicação existente do `eventId` e o controlador do modal impedem repetição de eventos/handshakes. Uma execução aceita cria uma fonte Web Audio sem loop. Após tocar, desligar e religar não repete o anúncio consumido. Fechar, silenciar ou substituir cancela a fonte e o agendamento pendente. Uma resolução tardia de `resume()` ou download não dispara um anúncio cancelado.

O efeito terminar **não fecha a apresentação**. Ela continua aberta até ser fechada pelo participante ou substituída por outro anúncio, como antes. Não há música de fundo nem reprodução contínua.

## Origem do efeito padrão e investigação da referência

`public/sounds/impact.wav` é uma síntese original determinística de 0,95 segundo, mono PCM16 a 22.050 Hz, com 41.940 bytes. `scripts/generate-impact.py` documenta e reproduz a síntese: grave descendente, harmônicos, transiente de ruído e ecos finitos. Nenhum sample externo foi usado. O efeito e seu gerador seguem a licença MIT deste projeto. Os pequenos MP3/OGG de teste derivam dessa mesma síntese original, codificados por FFmpeg; não são usados como trilhas do aplicativo.

A referência foi relida em 14/11/2026: o botão toca um Audio no painel; o background tenta tocar antes do modal e envia uma flag para o modal tentar somente se a primeira tentativa falhou. Esse arranjo não garante a autorização de outro iframe e pode atrasar o visual. O Ardonia usa um único responsável pelo som após renderizar a apresentação.

O `anuncio.mp3` original tem 90.950 bytes e metadado de encoder `Lavf60.12.101`; isso não identifica uma licença de reutilização. Não foi encontrada licença explícita no repositório/arquivo. O MP3 da referência não foi copiado, reproduzido ou distribuído.

Fontes consultadas por leitura HTTP:

- [Painel da referência](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/index.html), [background](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/background.html) e [anúncio](https://raw.githubusercontent.com/emixiszao/inventario-owlbear/main/anuncio.html).
- [Política oficial do Chrome](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/autoplay/index.md).
- [Guia de autoplay MDN/Mozilla](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/media/guides/autoplay/index.md).
- [Formatos de áudio MDN](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/media/guides/formats/audio_codecs/index.md).

## Evidência e limitações de teste

Há testes do motor com APIs simuladas para bloqueio, cancelamento, limites e ausência de repetição; testes do controlador; e teste multiplayer com SDK real, host e agendador de áudio simulados. Outro teste usa o **Web Audio real do Chromium**, decodifica o WAV e verifica que um clique agenda uma única fonte real sem loop; MP3 e OGG da síntese também foram decodificados pelo Chromium real. Isso demonstra funcionamento das APIs no ambiente, sem comprovar som audível em alto-falantes físicos.

Não foi realizado teste em sala real do Owlbear, Firefox, Safari/iOS ou Android físico. Depois de republicar, teste com um jogador em outro dispositivo, incluindo fechar o painel, desbloquear no anúncio quando solicitado, anunciar duas vezes, silenciar individualmente e trocar o efeito. Veja também [validação](validacao.md).
