# 🖼️ Processamento de Mídia, Figurinhas e Música

A HikariZap conta com um subsistema de manipulação multimídia projetado para produzir figurinhas de alta qualidade, extrair áudios da internet e realizar downloads musicais em qualidade de estúdio.

---

## 📂 Sumário

1. [🎨 1. Arquitetura de Figurinhas (Sharp + FFmpeg)](#-1-arquitetura-de-figurinhas-sharp--ffmpeg)
2. [🔄 2. Reversão de Figurinhas para Imagem e GIF (>toimg)](#-2-reversão-de-figurinhas-para-imagem-e-gif-toimg)
3. [🎵 3. Download Musical de Estúdio (Deezer HQ 320kbps)](#-3-download-musical-de-estúdio-deezer-hq-320kbps)
4. [🎬 4. Downloader de Vídeos e Áudios Web (yt-dlp)](#-4-downloader-de-vídeos-e-áudios-web-yt-dlp)
5. [🎮 5. Extração e Validação de Torrents de Jogos](#-5-extração-e-validação-de-torrents-de-jogos)
6. [💡 Dicas de Especialista](#-dicas-de-especialista)

---

## 🎨 1. Arquitetura de Figurinhas (Sharp + FFmpeg)

O módulo `src/services/stickerService.js` resolve o problema comum de figurinhas esticadas ou cortadas que ocorrem em bots legados:

### Tratamento de Imagens Estáticas:
1. **Inspeção de Dimensões:** A biblioteca **Sharp** inspeciona a largura e altura do arquivo original.
2. **Cálculo de Proporção:** Calcula o fator de escala mantendo a proporção exata da imagem.
3. **Canvas 512×512 com Margens Transparentes:** A imagem é centralizada sobre um canvas transparente quadrado de 512×512 pixels.
4. **Codificação WebP:** O arquivo é exportado em formato WebP otimizado com compressão sem perda visível.
5. **Injeção de Metadados EXIF:** Os blocos de metadados do WhatsApp são anexados ao WebP, identificando o pacote e a autoria.

### Tratamento de Figurinhas Animadas (Vídeos e GIFs):
1. **Filtro de Duração:** Vídeos de até 10 segundos são aceitos.
2. **Processamento via FFmpeg:**
   - Redimensionamento proporcional para caber dentro da caixa delimitadora de 512×512 pixels.
   - Aplicação de preenchimento (`pad=512:512:(512-iw)/2:(512-ih)/2:color=black@0.0`) com transparência total.
   - Ajuste de taxa de quadros (framerate) para 24 fps e codificação contínua em loop.
3. **Controle de Tamanho:** O arquivo WebP final é gerado com otimização de compressão para ficar rigorosamente abaixo do limite de 1 MB exigido pelo WhatsApp.

---

## 🔄 2. Reversão de Figurinhas para Imagem e GIF (`>toimg`)

Ao responder a uma figurinha no chat com o comando `>toimg` (ou `>sticker2image`):

- **Stickers Estáticos:** São decodificados pelo Sharp e convertidos para o formato **PNG** nativo de alta qualidade com canal alfa transparente preservado.
- **Stickers Animados:** O FFmpeg decompõe todos os quadros do WebP animado e reconstrói um arquivo **GIF** autêntico, permitindo que os usuários salvem a animação em qualquer dispositivo ou compartilhem fora do WhatsApp.

---

## 🎵 3. Download Musical de Estúdio (Deezer HQ 320kbps)

Para garantir máxima fidelidade de áudio sem artefatos de compressão do YouTube, a Hikari utiliza o ecossistema Deezer:

- **Busca por Nome e Artista (`>musica`):** A requisição consulta a API REST oficial do Deezer para localizar a faixa original de álbum.
- **Download via Deemix:** O script Python `src/services/download_deezer.py` conecta ao serviço utilizando o token `DEEZER_ARL` e realiza o download direto em **MP3 a 320 kbps (HQ)**.
- **Metadados Completos:** O arquivo MP3 inclui capa em alta resolução embutida (ID3 Tag), nome do artista, título da faixa e álbum oficial.
- **Autolimpeza:** O arquivo é despachado como documento/áudio para o usuário e o arquivo temporário no disco da VPS é excluído imediatamente.

---

## 🎬 4. Downloader de Vídeos e Áudios Web (yt-dlp)

Os comandos `>baixar_video` e `>baixar_audio` integram o poder do `yt-dlp`:

- **Extração Apenas de Áudio:** Ao usar `>baixar_audio`, apenas a trilha sonora original (`bestaudio`) é baixada, sendo convertida dinamicamente pelo FFmpeg para MP3 sem baixar o fluxo de vídeo, economizando largura de banda.
- **Respeito aos Limites do WhatsApp:** Se o arquivo final ultrapassar a variável `WHATSAPP_MAX_MEDIA_MB` (padrão 16 MB), o download é cancelado com um aviso claro ao usuário, evitando sobrecarga na conexão.
- **Suporte a Cookies:** Para plataformas com restrições de login, você pode configurar o caminho de um arquivo de cookies em `YTDLP_COOKIES_PATH` no seu `.env`.

---

## 🎮 5. Extração e Validação de Torrents de Jogos

Ao utilizar o comando `>torrent nome`:

1. **Varredura Local:** O serviço consulta os catálogos locais `src/data/fitgirl.json` e `src/data/dodi.json` (fornecidos pelo usuário, não inclusos no repositório).
2. **Seleção de Repacks:** Até 5 itens mais relevantes são selecionados com título, tamanho descompactado e data do release.
3. **Validação Criptográfica de Infohash:** A Hikari confere o hash do magnet link (BTIH). Se o serviço de cache estiver indisponível, o magnet link completo original é preservado com integridade.
4. **Entrega em Documento:** O magnet é entregue em um pequeno arquivo `.txt` formatado, facilitando a cópia ou importação direta no seu cliente torrent preferido (como qBittorrent).

---

## 💡 Dicas de Especialista

- 💡 **Vídeos sem Corte:** Ao mandar um vídeo na vertical para virar figurinha com `>sticker`, a Hikari não corta o topo nem a base do vídeo; ela coloca margens laterais invisíveis para manter 100% da sua filmagem.
- 💡 **Uso de Memória em VPS:** A conversão de mídia roda de forma serializada na fila, garantindo que mesmo servidores modestos com 1 GB de RAM consigam converter vídeos e áudios sem atingir estouro de memória (Out-Of-Memory).

---

[🏠 Voltar ao Menu Principal](./README.md)

