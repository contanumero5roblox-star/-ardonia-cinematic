# Volume e apresentação limpa — 1.1.2

## Evidência anterior à correção

O caso original do participante não foi observado numa sala real. Não se afirma que ele possuía uma instalação duplicada. A investigação reproduziu um defeito permitido pelo código anterior: a exclusão de fontes valia dentro de cada `EffectPlayer`, mas não impedia dois proprietários de áudio no mesmo participante.

No commit `ca105554aeb769f9c5ef9dcbf3f68350ede68961`, um teste com SDK e Web Audio reais, host simulado e **dois backgrounds da mesma implantação/conexão** produziu duas fontes simultâneas após um único anúncio. Cada GainNode manteve corretamente o volume 0,65; a soma de ganhos das duas cadeias chegou a aproximadamente 1,30. Não foi necessário modificar o WAV nem desabilitar a política de autoplay.

| Reprodução controlada anterior | Máximo de fontes conectadas ativas | Ganho por fonte |
| --- | --- | --- |
| Um EffectPlayer, dez pedidos com intervalo de 12 ms | 1 | 0,65 |
| Dois backgrounds, um anúncio recebido por ambos | **2** | 0,65 cada |

Uma renderização PCM nativa com `OfflineAudioContext`, usando o mesmo buffer alinhado, confirmou a consequência da soma:

| PCM controlado | Pico | RMS |
| --- | ---: | ---: |
| Uma cópia, ganho 0,65 | 0,559008 | 0,086987 |
| Duas cópias simultâneas, ganho 0,65 cada | 1,118015 | 0,173974 |

O aumento de amplitude nesse caso controlado foi **6,0206 dB**; o pico excedeu 1 antes da saída. Isso mede o sinal digital renderizado, não dB SPL em alto-falantes físicos nem o nível ouvido na sessão do usuário. Fontes com tempos/fases diferentes também podem se somar de modo variável.

Os anúncios rápidos com apenas um proprietário já mostravam ganho constante e máximo de uma fonte antes da proteção adicional. Portanto não se atribui a causa a um GainNode isolado ou a uma corrida interna não reproduzida.

## O que mudou

- O primeiro background publica sua bridge sincronamente. Outro background da mesma implantação no mesmo cliente encontra esse proprietário e não cria outro controlador, receptor ou modal concorrente.
- Dentro da sala, testes e ativação no painel usam o proprietário persistente; se ele não estiver acessível, não se inicia um teste local alternativo capaz de competir com o background.
- O modal não tem mais controles, mensagens, fallback manual ou `EffectPlayer`. Ele apenas sinaliza RENDERED/STOP. A UI cinematográfica permanece imagem/título/descrição opcional/X.
- O mecanismo existente de `stop`, desconexão, geração de pedidos, ID único e STOP guardado por evento continua interrompendo a fonte antiga antes da seguinte, inclusive entre teste e anúncio.
- Não se mudou o volume escolhido nem se introduziu normalização, compressor ou redução do efeito padrão.

O arquivo `public/sounds/impact.wav` é idêntico ao commit anterior. SHA-256:

```text
6af00f9a702bff296e394f03c9e11bd59748f7a868e1a1eac7538fd0db99e0e2
```

## Testes de regressão

`tests/e2e/audio-owner.spec.ts` verifica uma tentativa de dois backgrounds com SDK/Web Audio reais e host simulado. A instrumentação de teste conta contextos, `start`, `stop`, desconexão e término, além do ganho e pico do buffer. Inclui teste manual no painel seguido de anúncios rápidos e alternância entre efeito padrão e URL personalizada. A versão corrigida deve manter um proprietário/contexto e no máximo uma fonte ativa.

`tests/e2e/audio-stress.spec.ts` usa dois clientes independentes, desktop e viewport móvel com toque, com ativação real e painéis fechados:

- Cinco anúncios com intervalos de cinco segundos.
- Dez anúncios enviados em sequência rápida; cenas ultrapassadas podem ser substituídas conforme a política existente, sem tocar uma fila atrasada.
- Substituição de uma apresentação ainda aberta e quatro ciclos de fechar/reabrir imediatamente.
- Reutilização do efeito, URL personalizada, ganho individual distinto e pico do buffer constante.
- Botão X por clique e toque, nenhum controle/status de áudio na cinematic e nenhum ID reproduzido duas vezes.

As medições usam `AudioParam` nativo Float32: valores como 0,360000014 e 0,810000002 correspondem aos volumes escolhidos 0,36 e 0,81, não a amplificação. A tolerância dos testes respeita essa representação.

Os testes registram medidas apenas no ambiente do runner e salvam resumos JSON em seus resultados. Não há logger de eventos, contador ou diagnóstico temporário no código de produção. A instrumentação de regressão não integra o build da extensão.

## Medidas da execução final

A regressão com dois backgrounds terminou com **um contexto, 12 inícios sequenciais, máximo de uma fonte ativa e um único proprietário**. Esses 12 inícios são a confirmação, um teste manual e dez anúncios efetivamente iniciados. O ganho de todas as fontes foi 0,649999976 (o Float32 correspondente a 0,65).

No stress com dois clientes, os intervalos medidos entre os cinco envios espaçados foram 4999 ms, 5001 ms, 4999 ms, 5000 ms. As medições foram:

| Cliente | Inícios totais | Máximo de fontes ativas | Contextos | Ganho em todos os inícios | Términos naturais | Interrupções |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Mestre | 16 | 1 | 1 | 0.360000014 | 7 | 9 |
| Jogador com toque | 17 | 1 | 1 | 0.810000002 | 7 | 10 |

Os totais incluem o teste de ativação. Há dez envios rápidos nesse cenário, mas uma cena ultrapassada pode ser descartada pela política de substituição: não existe fila para tocar anúncios antigos. Os diferentes totais entre clientes não são duplicação; nenhum ID foi iniciado mais de uma vez. O pico do buffer permaneceu constante em cada contexto; a taxa de amostragem nativa pode produzir números diferentes entre máquinas sem alterar o WAV.

## Limitações

O host e a entrega de eventos da sala são simulados; SDK, decoder e Web Audio dos cenários nativos são reais. Não foram testados o serviço real do Owlbear Rodeo, Firefox/Safari, alto-falantes físicos, iOS ou Android físico. Viewport móvel/toque não equivale a um telefone físico.

A evidência comprova o defeito de proprietários concorrentes e sua proteção, e mede ganho/pico consistentes nos cenários descritos. Ela não identifica remotamente todas as condições da sala que originou o relato, nem garante percepção sonora idêntica em dispositivos diferentes. Autoplay continua sujeito ao navegador; bloqueios são informados exclusivamente no painel. Recarregue a sala após publicar para descarregar os backgrounds da versão antiga antes de validar três ou mais anúncios.
