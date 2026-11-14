# Validação e estado da entrega

Data: 14/11/2026. Ambiente Linux, Node.js 24.22.1, npm 11.9.0, Chromium instalado em `/usr/bin/chromium`. Esta é uma implementação nova, integrada ao SDK oficial 3.1.0.

## Resultado executado

| Verificação | Resultado |
| --- | --- |
| `npm ci` | instalação reproduzida com lockfile, sem alterar dependências durante a instalação |
| `npm test` | **53 testes passaram**, 3 arquivos; nenhum teste falhou ou foi pulado |
| `npm run build` | TypeScript e build Vite aprovados; manifesto v1, três HTML e recursos locais verificados |
| `npm run test:e2e` | **13 testes passaram**, Chromium; nenhum teste falhou ou foi pulado |
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

As capturas em `docs/screenshots/` ilustram a prévia local com a arte SVG original. Não representam uma captura de sala real.

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
7. Exportar backup, reabrir o painel e importar em outro navegador. A transferência é manual; não há sincronização automática.
8. Testar entrada tardia/reconexão: não se espera replay; mestre anuncia novamente. Testar navegador suspenso e avisar que o envio não tem confirmação por participante.

Publicação do ambiente de nuvem, envio Git, deploy do site e instalação na sala são estados diferentes. O resultado remoto Git verificável será fornecido com SHA e link na entrega da conversa; para o checkout, consulte `git log -1` e `git ls-remote origin refs/heads/main`.
