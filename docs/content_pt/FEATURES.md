# ✨ Funcionalidades, Inteligência Artificial e Mídia

A HikariZap não é um simples robô de respostas pré-programadas. Ela é uma **Agente Autônoma** com raciocínio iterativo (Agent Loop), integração direta com ferramentas externas do mundo real e suporte nativo às particularidades do WhatsApp.

---

## 📂 Sumário

1. [🧠 1. Inteligência Artificial e o Ciclo de Vida do Chat](#-1-inteligência-artificial-e-o-ciclo-de-vida-do-chat)
2. [🖼️ 2. Motor Avançado de Figurinhas (Stickers)](#-2-motor-avançado-de-figurinhas-stickers)
3. [🎮 3. Cantinho dos Games (Torrents & Steam)](#-3-cantinho-dos-games-torrents--steam)
4. [🌍 4. Pesquisa Web em Tempo Real](#-4-pesquisa-web-em-tempo-real)
5. [💱 5. Mestre das Finanças e Câmbio de Moedas](#-5-mestre-das-finanças-e-câmbio-de-moedas)
6. [🎵 6. Downloads de Vídeo, Áudio e Deezer HQ](#-6-downloads-de-vídeo-áudio-e-deezer-hq)
7. [🔍 7. Visão Computacional e Reconhecimento de Anime](#-7-visão-computacional-e-reconhecimento-de-anime)
8. [🎙️ 8. Transcrição de Voz e Respostas em Áudio](#-8-transcrição-de-voz-e-respostas-em-áudio)
9. [💡 Dicas de Uso Avançado](#-dicas-de-uso-avançado)

---

## 🧠 1. Inteligência Artificial e o Ciclo de Vida do Chat

O processamento cognitivo da Hikari opera por meio de uma **Fila de Mensagens Serializada (`src/whatsapp/queue.js`)** e um loop autônomo de raciocínio (`executeAgentLoop`):

### Fluxo de Conversação:

1. **Captura e Filtragem de Mensagens:**
   - **No Privado:** Qualquer mensagem enviada à Hikari é direcionada ao processamento imediato.
   - **Em Grupos:** O bot só responde se for mencionado (`@número`), se a mensagem contiver o gatilho `"Hikari"`, se for uma resposta direta (quote/reply) a ela, ou se utilizar um comando explícito de prefixo `>` (ou `/`).
2. **Contexto Deslizante (Memória Recente):**
   - O bot mantém um histórico em memória das últimas 15 mensagens trocadas no chat (`Store`), garantindo respostas coerentes com o fluxo da conversa sem armazenar dados em texto aberto ou causar overhead desnecessário de tokens.
3. **Loop de Ferramentas (Function Calling):**
   - O modelo de linguagem recebe o catálogo de funções disponíveis em `src/data/mcp_tools.json`.
   - Se o usuário fizer uma solicitação complexa (como *"Pesquise o preço do Portal 2 na Steam e converta 10 dólares em reais"*), a IA decide por conta própria chamar `check_steam`, em seguida `convert_currency`, coleta os resultados e sintetiza uma única resposta final amigável.
4. **Serialização e Anti-Spam:**
   - Para respeitar os limites de envio do WhatsApp, as mensagens são despachadas com espaçamento mínimo de 2 segundos, limite de 20 mensagens por minuto e corte automático em 24.000 caracteres.

---

## 🖼️ 2. Motor Avançado de Figurinhas (Stickers)

O sistema de figurinhas (`src/services/stickerService.js`) foi construído do zero utilizando **Sharp** e **FFmpeg**:

- **Proporção Perfeita (Sem Distorção):** As imagens são redimensionadas para a moldura quadrada padrão de 512×512 com preenchimento transparente (padding), preservando a proporção original do conteúdo horizontal ou vertical.
- **Vídeos e GIFs Animados:** Converte vídeos curtos, GIFs e gravações de até 10 segundos em figurinhas animadas em formato WebP a 24 quadros por segundo.
- **Injeção de Metadados EXIF:** Cada sticker recebe metadados com pacote e autor configuráveis nos metadados técnicos do WhatsApp.
- **Reversão (`>toimg` / `>sticker2image`):**
  - Figurinhas estáticas são convertidas de volta para imagens PNG transparentes de alta fidelidade.
  - Figurinhas animadas são desempacotadas e reconstruídas como arquivos `.gif` com todos os frames preservados.

---

## 🎮 3. Cantinho dos Games (Torrents & Steam)

A Hikari disponibiliza consulta e extração imediata de arquivos para jogos de PC:

- **Bases de Repacks FitGirl e DODI:** Consulta local aos catálogos `src/data/fitgirl.json` e `src/data/dodi.json` (arquivos externos configurados pelo usuário, não inclusos no repositório).
- **Validação de Infohash:** Extrai o hash criptográfico do magnet e verifica a integridade do link antes de enviar o documento `.txt` pronto para download no WhatsApp.
- **Isolamento de Seleção por Conversa:** Ao realizar uma busca com `>torrent nome`, os resultados ficam indexados temporariamente por 10 minutos. O usuário pode simplesmente responder com o número correspondente (ex: `2` ou `>torrent 2`) para receber o magnet desejado.
- **Consulta Oficial à Steam (`>steam nome`):** Busca títulos na loja da Steam e retorna dados oficiais de preço, desenvolvedora, porcentagem de desconto e sinopse do jogo.

---

## 🌍 4. Pesquisa Web em Tempo Real

Quando questionada sobre notícias, fatos recentes ou documentações técnicas, a Hikari aciona a ferramenta `search_web`:

- Utiliza raspagem semântica limpa para consultar a internet.
- Lê as páginas retornadas, filtra o ruído de anúncios e formata um resumo claro e direto diretamente no chat.

---

## 💱 5. Mestre das Finanças e Câmbio de Moedas

A ferramenta `convert_currency` permite conversões monetárias em tempo real:

- Suporta dezenas de moedas fiduciárias (USD, BRL, EUR, JPY, GBP) e criptomoedas de destaque (BTC, ETH, SOL).
- Calcula taxas diretas, inversas e cruzadas com base na cotação oficial.
- Apresenta no rodapé a fonte da taxa (ex: AwesomeAPI ou Frankfurter) e a data/horário exato de publicação pelo provedor.

---

## 🎵 6. Downloads de Vídeo, Áudio e Deezer HQ

A Hikari oferece um módulo versátil de mídia:

- **Downloads da Internet (`>baixar_video` e `>baixar_audio`):** Utiliza `yt-dlp` e `ffmpeg` para capturar mídias de plataformas suportadas, respeitando o limite configurado em `WHATSAPP_MAX_MEDIA_MB`.
- **Motor Deezer HQ 320kbps (`>musica nome e artista`):** Busca no catálogo oficial do Deezer e utiliza a biblioteca `deemix` para baixar o áudio de estúdio oficial em altíssima fidelidade. Arquivos baixados são transitórios e removidos do disco logo após a entrega.

---

## 🔍 7. Visão Computacional e Reconhecimento de Anime

A ferramenta `identify_anime` integra-se com a API pública do **Trace.moe**:

- Ao anexar um frame, print ou imagem de animação com o comando `>anime`, a Hikari identifica o anime exato, o episódio e a minutagem aproximada da cena.

---

## 🎙️ 8. Transcrição de Voz e Respostas em Áudio

- **Transcrição STT (`>transcrever`):** Ao receber uma mensagem de voz ou áudio encaminhado, a Hikari transcreve o conteúdo por meio de modelos Whisper Turbo na nuvem (Groq / Wit.ai).
- **Respostas Faladas (`>audio pergunta`):** A IA gera a resposta em texto e a sintetiza imediatamente em formato de áudio natural (PTT) com voz expressiva via XTTS v2.
- **Leitura em Voz Alta (`>falar texto`):** Lê literalmente qualquer texto informado utilizando síntese vocal.

---

## 💡 Dicas de Uso Avançado

- 💡 **Pedidos Naturais:** Em vez de comandos fixos, experimente pedir: *"Hikari, faça uma figurinha dessa imagem aqui e pesquise quanto tá o dólar hoje"*. A IA executará os dois passos sem que você precise digitar prefixos.
- 💡 **Limpeza de Conversa:** Se a IA começar a misturar tópicos antigos em um chat longo, envie `>limpar` para reiniciar o contexto recente da conversa.

---

[🏠 Voltar ao Menu Principal](./README.md)

