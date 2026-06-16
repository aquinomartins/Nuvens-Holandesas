# Nuvens Holandesas — Arquiteturas Atmosféricas Distribuídas

Aplicação web interativa para exposição presencial. Visitantes acessam `/participar` pelo celular, escrevem uma frase curta e controlam uma nuvem textual coletiva exibida em tempo real em `/exhibition`.

## Estrutura

- `server.js` — servidor Node.js com Express e Socket.IO, validação de dados, limite de nuvens e evaporação gradual.
- `public/index.html` — página inicial.
- `public/participar.html` — interface mobile dos visitantes.
- `public/exhibition.html` — canvas fullscreen da exposição.
- `public/css/style.css` — identidade visual sóbria e responsiva.
- `public/js/shared.js` — utilitários compartilhados e conexão Socket.IO com reconexão.
- `public/js/participant.js` — criação e atualização da nuvem do visitante.
- `public/js/exhibition.js` — paisagem generativa, nuvens tipográficas e sombras.

## Rodar localmente

```bash
npm install
npm start
```

Depois acesse:

- Página inicial: <http://localhost:3000/>
- Visitante: <http://localhost:3000/participar>
- Tela da exposição: <http://localhost:3000/exhibition>

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
7. Gere um QR Code apontando para `https://sua-url.railway.app/participar`.
8. Na tela da exposição, abra `https://sua-url.railway.app/exhibition` em fullscreen.

## Eventos WebSocket

A aplicação implementa os eventos solicitados:

- `agent:join`
- `cloud:create`
- `cloud:update`
- `cloud:remove`
- `scene:state`
- `scene:reset`
- `agent:disconnect`

Cada visitante controla somente uma nuvem por vez. O servidor limita a cena a 80 nuvens simultâneas, remove excesso pelas mais antigas e evapora nuvens após alguns minutos.
