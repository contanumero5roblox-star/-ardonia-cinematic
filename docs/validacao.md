# Validação e estado da entrega

Data: 14/11/2026. Ambiente Linux, Node.js 24.22.1, npm 11.9.0, Chromium instalado em `/usr/bin/chromium`. A versão 1.1.2 preserva a extensão existente, limpa a apresentação e protege a exclusão de fontes de áudio, integrada ao SDK oficial 3.1.0.

## Resultado executado

| Verificação | Resultado |
| --- | --- |
| `npm ci` | instalação reproduzida com lockfile, sem alterar dependências durante a instalação |
| `npm test` | **136 testes passaram**, 7 arquivos; nenhum teste falhou ou foi pulado |
| `npm run build` | TypeScript e build Vite aprovados; manifesto v1, três HTML e recursos locais verificados |
| `npm run test:e2e` | **27 testes passaram**, Chromium; nenhum teste falhou ou foi pulado |
| `npm audit` | nenhuma vulnerabilidade conhecida apontada no conjunto instalado |
| Build para prefixo Pages | aprovado em servidor estático local sob `/-ardonia-cinematic/`, com MIME e URLs verificadas |
| ZIPs | gerados por `npm run package`, integridade verificada pelo módulo zipfile |

`npm run check` executou a sequência completa de testes, build e navegador com sucesso. Os testes inicialmente encontraram mensagens de erro sobrescritas no modo local e deslocamento do botão Salvar ao carregar prévia de imagem. Ambos foram corrigidos e a suíte final passou. A auditoria inicial identificou uuid transitivo e versão de ferramenta de testes com alertas; o override compatível de uuid e a atualização do Vitest resolveram os alertas na execução final.

## O que os testes exercitam

- Validação de títulos, descrição vazia/longa, datas, IDs, tamanho e URLs HTTPS sem credenciais.
- Backups JSON, limites de quantidade/tamanho, IDs duplicados, versão incompatível e rejeição atômica de importação inválida.
- Persistência local, falha de quota, armazenamento indisponível e preservação de conteúdo corrompido.
- Criação, edição, pesquisa sem acentos, exclusão com cancelamento, reabertura, download real de backup e importação com conflitos confirmados.
- Texto hostil exibido literalmente, imagem com proporção preservada e fallback após erro 404.
- Títulos de 180 caracteres e descrições de 6.000, descrição vazia, ausência de imagem, fechamento e redução de movimento.
- Viewports **1280×800, 375×812, 812×375 e 320×568**: sem rolagem horizontal; botão de fechar de 46×46 acessível mesmo após rolagem vertical.
- Protocolo: autenticação por conexão/papel, expiração, relógio futuro, deduplicação, eventos concorrentes, substituição, falhas de modal, recuperação e limite de 15.000 bytes UTF-8.
- Integração de background com dublê do SDK: URL com subdiretório e somente ID, verificação do remetente e handshake LOCAL.
- **SDK real com host simulado**: dois contextos de navegador independentes (GM 1280×800 e jogador móvel 390×844 com toque). Clique real em Anunciar, entrega ALL, background de cada cliente, abertura de modal, READY/DATA LOCAL, renderização em ambos, fechamento e anúncios seguintes, substituição sem duplicar, rejeição de PLAYER com papel forjado e biblioteca ausente no storage do jogador.
- **Build real**: servidor HTTP estático separado serve somente `dist`; manifesto e suas URLs, HTML, scripts e CSS com MIME correto, 404 sem fallback, CRUD/persistência e prévia móvel com a ilustração própria. Nenhum erro JavaScript ou recurso local falhou nesse teste.

## Verificação adicional do áudio (1.1.0)

- 38 testes de validação e preferências, 18 do motor e cinco de compatibilidade/integração som-biblioteca-protocolo foram adicionados; os demais testes existentes foram mantidos/adaptados. Esses testes compuseram a versão 1.1.0; a correção 1.1.1 adiciona o controlador persistente e sua cobertura.
- Os testes de navegador adicionais verificam o decoder real do Chromium para WAV, MP3 e OGG originais, um clique real que habilita o AudioContext e agenda uma fonte sem loop, controles individuais, efeito geral/customizado, reset, erro de decoder e persistência. Também isolam o controlador para bloqueio, gesto explícito, cancelamento, limite de atraso e ausência de repetição. A suíte atual também inclui a regressão nativa descrita abaixo.
- O multiplayer usa SDK real com host e agendador de áudio simulados; verifica fonte única no background de cada cliente, volume próprio, URL geral e específica, mute individual e rejeição/deduplicação sem som adicional. Não comprova rede real nem alto-falante físico.
- `impact.wav` foi criado sem samples externos: 0,95 s, 41.940 bytes, mono PCM16 a 22.050 Hz. Seu conteúdo foi decodificado pelo Web Audio real; pico abaixo de clipping e energia não nula verificados. MP3 e OGG de teste derivam da mesma síntese. O MP3 da referência não foi copiado.
- O build verifica o WAV, e o smoke de produção também verifica sua URL/MIME sob o prefixo Pages.
- Uma primeira execução do teste multiplayer de áudio falhou porque o seletor de texto exato não considerava o indicador de status no botão de expansão. O seletor foi corrigido; a execução final completa passou sem falhas ou testes pulados.

Leia [o guia de áudio](audio.md) para autoplay, CORS, formatos, limites e hospedagem de arquivos.

As capturas em `docs/screenshots/` ilustram a prévia local com a arte SVG original. Não representam uma captura de sala real.

## Regressão de continuidade (1.1.1)

- Causa: a versão 1.1.0 ativava um contexto no painel, criava outro no modal e o descartava a cada fechamento. A preferência salva não autorizava o novo contexto.
- Correção: proprietário único no background; ativação síncrona por bridge de mesma origem verificada no navegador; estado pronto separado da preferência; RENDERED/STOP locais autenticados por conexão/ID; contexto preservado ao fechar UI.
- 19 testes do controlador persistente e dois da integração de ciclo de vida no background foram adicionados. Cobrem três eventos após uma ativação, repetição, confirmação concorrente com RENDERED, cancelamento tardio/antigo, mute, volume, efeitos, falhas e preferências.
- O teste nativo usa Chromium/Web Audio/SDK reais, duas instâncias de navegador, clique/toque reais, pai HTTP de outra origem e terceiro armazenamento bloqueado. O servidor/host continuam simulados. Foram entregues três anúncios com ambos os painéis fechados e fechamento de modal entre cada um; 6,5 s de espera deixam expirar a ativação transitória. Um único contexto e quatro fontes (confirmação + três entradas) por participante, zero contextos nos modais normais. Todos os anúncios agendaram com ativação transitória falsa e contexto em execução.
- Não foram usadas flags de autoplay, storage simulado ou avaliações com gesto artificial. Esse teste isola continuidade do áudio recebido; o botão Anunciar é coberto separadamente pelo teste de SDK/host simulado.
- A versão 1.1.1 possuía fallback manual no modal. Na 1.1.2 ele foi removido: a apresentação não oferece controles/status de áudio e os testes verificam esse requisito. Os controles da seção Som de entrada e as funções da biblioteca permanecem no painel.
- Diagnóstico inicial do fixture nativo: resposta HTTP interceptada disparava a proteção de rede local do Chromium; foi substituída por servidor HTTP real. Uma execução com edição/HMR em paralelo reiniciou o background; a suíte final foi executada com fonte estável e passou. Não se classificaram esses problemas de fixture como testes positivos.
- Resultado histórico da 1.1.1: 135 testes unitários/integração e 27 de navegador. Veja a regressão 1.1.2 abaixo para a suíte atual.

## Apresentação limpa e volume (1.1.2)

- O modal agora apenas sinaliza renderização e fechamento; não cria elementos de áudio, mensagens, fallback ou contextos locais. O X, Esc, imagem, descrição opcional, rolagem vertical e animações foram preservados.
- A investigação reproduziu na versão anterior dois backgrounds do mesmo participante criando duas fontes simultâneas. Cada ganho continuava 0,65; a soma chegou a 1,30. Uma renderização PCM alinhada confirmou o dobro de amplitude (+6,0206 dB). Uma única instância sob rajadas não mostrou ganho excessivo. Não se afirma que a sala do usuário tinha instalação duplicada; o defeito comprovado era a permissão para proprietários concorrentes.
- A nova regressão com duas tentativas de background mantém **um contexto, máximo de uma fonte conectada ativa e ganho constante**, incluindo um teste manual imediatamente antes de dez anúncios, efeitos padrão/customizados e fechamento. A primeira execução apontou apenas referência de pico inadequada para a taxa de amostragem nativa; a comparação passou a usar o primeiro buffer do próprio run, sem alterar o WAV.
- O teste de stress nativo executa cinco entregas a intervalos de cinco segundos, dez rápidas e quatro ciclos de fechar/reabrir, dois clientes (desktop/toque), sem painéis abertos. Verifica substituição, custom URL, ID único, ganho individual, pico do buffer, término/interrupção, máximo de uma fonte e somente o X como botão na cinematic. A tolerância dos ganhos respeita o Float32 do AudioParam.
- Instrumentação somente nos testes; nenhum logger/contador foi adicionado ao bundle. Os testes gravam resumos de eventos e métricas nos resultados do runner.
- O WAV original permaneceu byte a byte idêntico; o volume escolhido não foi reduzido, nem houve compressor/normalização.
- Resultado da suíte 1.1.2: **136 testes unitários/integração e 27 de navegador**, incluindo regressões nativas e testes com dublês. Não se confunde host simulado com sala real.

Medições, causa reproduzida e limites: [docs/volume-validation.md](volume-validation.md).

## O que ainda não foi verificado

Não foi realizado ensaio em sala real do Owlbear Rodeo, Windows físico, Safari/iOS ou Chrome/Android físico. O host simulado implementa o contrato de mensagens observado no SDK; ele não comprova rede, permissões, roteamento, ciclo de vida, suspensão ou layout do host real. A seleção real de imagens via `OBR.assets.downloadImages` também depende desse ensaio.

O site de produção não foi publicado por esta tarefa. O acesso administrativo `api.github.com` e o domínio de hospedagem github.io retornaram bloqueio 403 pelo proxy do ambiente; isso **não prova que o site está fora do ar** nem revela o plano da conta. As condições de Pages privado foram verificadas nas fontes oficiais; não foi possível consultar as configurações da conta. CI/Pages no GitHub não foram acompanhados por API e não são declarados aprovados remotamente.

## Checklist de aceitação na sala real

1. Publicar o build em HTTPS público e abrir o manifesto e seus recursos sem login. Verificar que os cabeçalhos permitem iframe.
2. Instalar a extensão numa sala de teste e entrar como GM no Windows; conectar um segundo navegador como jogador e um celular físico.
3. Manter o painel dos jogadores fechado e anunciar uma cena. Conferir imagem, título e descrição em todos, incluindo o GM.
4. Fechar em cada cliente e anunciar novamente; em seguida anunciar duas cenas rapidamente e conferir que a mais recente prevalece, sem modais duplicados.
5. Testar sem descrição, imagem inválida, textos máximos e imagem selecionada no Owlbear. Confirmar acesso e validade durável do link com os jogadores.
6. Girar o telefone, rolar texto longo, fechar por toque e testar preferência de reduzir animação.
7. Abrir **Som de entrada** como mestre e jogador, ativar/testar, anunciar com painel fechado e conferir os avisos exclusivamente no painel se o navegador bloquear; a cinematic deve continuar sem controles de áudio. Testar volumes diferentes, mute individual, efeito geral, efeito específico, URL inacessível e ausência de duplicação. Confirmar que a cena não fecha quando o som termina.
8. Exportar backup, reabrir o painel e importar em outro navegador. A transferência é manual; não há sincronização automática.
9. Testar entrada tardia/reconexão: não se espera replay; mestre anuncia novamente. Testar navegador suspenso e avisar que o envio não tem confirmação por participante.

Publicação do ambiente de nuvem, envio Git, deploy do site e instalação na sala são estados diferentes. O resultado remoto Git verificável será fornecido com SHA e link na entrega da conversa; para o checkout, consulte `git log -1` e `git ls-remote origin refs/heads/main`.
