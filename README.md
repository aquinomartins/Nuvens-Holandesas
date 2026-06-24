# Nuvens Holandesas — Arquiteturas Atmosféricas Distribuídas

Aplicação web interativa para exposição presencial. Visitantes acessam `/participar` pelo celular, escrevem uma frase curta e condensam uma assinatura atmosférica coletiva exibida em tempo real em `/exhibition`. A frase não aparece como legenda: ela vira clima, borda, ritmo de pincelada, densidade, deriva, luz, sombra e duração da nuvem.

## Estrutura

- `server.js` — servidor Node.js com Express e Socket.IO, validação de dados, transformação determinística de texto em atmosfera gráfica, limite de nuvens e evaporação gradual.
- `public/index.html` — página inicial.
- `public/participar.html` — interface mobile dos visitantes.
- `public/exhibition.html` — canvas fullscreen da exposição.
- `public/css/style.css` — identidade visual sóbria e responsiva.
- `public/js/shared.js` — utilitários compartilhados e conexão Socket.IO com reconexão.
- `public/js/participant.js` — criação e atualização da nuvem do visitante.
- `public/js/exhibition.js` — pintura generativa em Canvas com fundo pictórico pré-renderizado e nuvens gráficas interativas.

## Direção estética da exposição

A rota `/exhibition` opera como uma pintura atmosférica viva, não como simulação meteorológica. A nova versão simplifica a antiga nuvem volumétrica e adota uma linguagem gráfica, expressiva e performática: céu dominante, horizonte baixo, campo/planalto do Cerrado, chapadas discretas, caminhos ocres, pinceladas aparentes, bordas marcadas, linhas curvas e massas de cor.

A inspiração geral vem da energia pictórica de campos, céus, nuvens e paisagens pós-impressionistas, especialmente pelo uso de pinceladas curtas, direcionais e rítmicas. A obra não copia uma pintura específica: continua sendo **“Nuvens Holandesas sobre o Planalto Central”**, com céu amplo, profundidade atmosférica, sombra atmosférica e nuvem como arquitetura da paisagem.

## Arquitetura visual e performance

O canvas foi separado em camadas lógicas:

1. **Fundo pictórico fixo ou semi-fixo**
   - Pré-renderizado em um canvas auxiliar (`backgroundCanvas`).
   - Reconstruído no carregamento e em mudanças de tamanho da janela.
   - Pode usar imagem autoral de fundo ou gerar uma paisagem procedural.
   - Concentra textura, pinceladas do céu, campo, planalto e vinheta para evitar redesenho pesado a cada frame.

2. **Camada interativa de nuvens**
   - Redesenhada em tempo real com economia formal.
   - Usa formas orgânicas em `Path2D`, preenchimentos simples, contornos expressivos, sombras gráficas e poucas pinceladas internas.
   - Evita blur pesado, centenas de partículas e aparência 3D/digital.

O loop de renderização limpa a tela, desenha o fundo pré-renderizado, atualiza nuvens, projeta sombras gráficas, desenha nuvens com bordas/pinceladas e aplica uma névoa atmosférica leve.

## Imagem de fundo opcional

Você pode substituir o fundo procedural por uma imagem autoral:

1. Crie a pasta `public/assets`, se ela ainda não existir.
2. Coloque a imagem em um destes caminhos:
   - `public/assets/background.jpg`
   - `public/assets/background.png`
3. Abra ou recarregue `/exhibition`.

A aplicação tenta carregar primeiro `/assets/background.jpg` e depois `/assets/background.png`. Se nenhuma existir, nada quebra: o fundo procedural pictórico é usado automaticamente. A imagem carregada é aplicada com lógica equivalente a `object-fit: cover` dentro do canvas e recebe uma veladura/textura leve para integrar as nuvens.

Para trocar a imagem, substitua o arquivo mantendo o mesmo nome. Em produção, faça commit da nova imagem ou envie-a junto com o deploy.

## Interação do visitante

Em `/participar`, o visitante escreve uma frase curta e ajusta controles simples:

- Posição no horizonte
- Altura no céu
- Escala da nuvem
- Distância
- Densidade
- Deriva
- Luz
- Sombra
- Traço da nuvem

A frase é sanitizada, limitada a 80 caracteres e transformada em uma semente determinística. Essa semente influencia número de lóbulos, curvatura, densidade, ritmo das pinceladas, direção de deriva, temperatura da cor, força do contorno e tempo de vida.

## Rodar localmente

```bash
npm install
npm start
```

Depois acesse:

- Página inicial: <http://localhost:3000/>
- Visitante: <http://localhost:3000/participar>
- Tela da exposição: <http://localhost:3000/exhibition>
- Saúde do serviço: <http://localhost:3000/health>

Para desenvolvimento com reinício automático do Node.js:

```bash
npm run dev
```

## Publicar no Railway

1. Crie uma conta em <https://railway.app/>.
2. Crie um novo projeto e conecte este repositório GitHub.
3. O Railway detectará o projeto Node.js automaticamente.
4. Configure o comando de start como:

```bash
npm start
```

5. Garanta que a variável `PORT` seja a porta fornecida pelo Railway. O servidor já usa `process.env.PORT` automaticamente.
6. Faça o deploy e abra a URL pública gerada.
7. Verifique `https://sua-url.railway.app/health`.
8. Gere um QR Code apontando para `https://sua-url.railway.app/participar`.
9. Na tela da exposição, abra `https://sua-url.railway.app/exhibition` em fullscreen.

## Eventos WebSocket

A aplicação implementa os eventos solicitados:

- `agent:join`
- `cloud:create`
- `cloud:update`
- `cloud:remove`
- `scene:state`
- `scene:request-state`
- `scene:reset`
- `agent:disconnect`

Cada visitante controla somente uma nuvem por vez. O servidor limita a cena a 80 nuvens simultâneas, remove excesso pelas mais antigas e evapora nuvens de visitantes entre 4 e 10 minutos, com fade gradual.

## Operação contínua em exposição

A aplicação foi preparada para rodar sem login e sem armazenamento de dados pessoais: o servidor mantém apenas estado efêmero em memória para sincronizar a cena e remove as nuvens automaticamente após alguns minutos.

Recursos de estabilidade:

- Reconexão automática do Socket.IO no cliente, com reconstrução da cena em `/exhibition` após reconectar.
- Validação e sanitização de textos e parâmetros no servidor antes de retransmitir eventos.
- Limite de frequência por visitante para reduzir spam de eventos.
- Limite máximo de 80 nuvens simultâneas, descartando as mais antigas quando necessário.
- Evaporação e remoção automática de nuvens antigas.
- Modo ambiente com 3 a 5 nuvens gráficas quando não há visitantes.
- Mensagem discreta de status em `/exhibition` exibida apenas durante erro ou instabilidade de conexão.
- Endpoint `/health` retornando `{ "status": "ok" }` para monitoramento.
- Logs do servidor para início, visitantes conectados, nuvens criadas, erros/desconexões e reset da cena.

## Variáveis de ambiente

- `PORT`: porta fornecida pelo Railway. Localmente, se não for definida, o app usa `3000`.
- `NODE_ENV`: ambiente de execução. Se não for definida, o servidor usa `production` como padrão.

## Checklist rápido para Railway

1. Conecte o repositório ao Railway.
2. Use Node.js 18 ou superior.
3. Mantenha o comando de instalação padrão do Railway ou rode `npm install`.
4. Configure o comando de start como `npm start`.
5. Não fixe a porta manualmente: o servidor lê `process.env.PORT` automaticamente.
6. Opcionalmente defina `NODE_ENV=production` nas variáveis do serviço.
7. Após o deploy, verifique `https://sua-url.railway.app/health`.
8. Use `https://sua-url.railway.app/participar` no QR Code dos visitantes e `https://sua-url.railway.app/exhibition` na tela principal.
