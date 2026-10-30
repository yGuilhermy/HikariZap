# 🎮 Guia Completo de Comandos (WhatsApp Edition)

Este documento descreve detalhadamente todos os comandos disponíveis na HikariZap, suas sintaxes, parâmetros aceitos e permissões de acesso.

---

## 📂 Sumário

1. [⌨️ 1. Prefixos e Formato de Entrada](#-1-prefixos-e-formato-de-entrada)
2. [🧠 2. IA, Fala e Transcrição](#-2-ia-fala-e-transcrição)
3. [🖼️ 3. Figurinhas e Processamento de Imagens](#-3-figurinhas-e-processamento-de-imagens)
4. [🎮 4. Jogos, Torrents e Consultas](#-4-jogos-torrents-e-consultas)
5. [🎵 5. Downloads de Mídia e Música](#-5-downloads-de-mídia-e-música)
6. [🛠️ 6. Comandos Utilitários de Chat](#-6-comandos-utilitários-de-chat)
7. [👑 7. Comandos de Administração (Owner Only)](#-7-comandos-de-administração-owner-only)
8. [💡 Dicas de Especialista](#-dicas-de-especialista)

---

## ⌨️ 1. Prefixos e Formato de Entrada

- **Prefixo Principal:** `>` (exemplo: `>ajuda`, `>sticker`).
- **Prefixo Alternativo:** `/` (exemplo: `/ajuda`, `/sticker`).
- **Linguagem Natural (Zero Prefixo):** Em chats privados ou ao chamar por "Hikari" em grupos, você pode formular pedidos livres como *"Hikari, pesquise o clima hoje"* ou *"Faz figurinha disso"*, citando a imagem.

---

## 🧠 2. IA, Fala e Transcrição

### `>pesquisa <assunto>`
Pesquisa na internet em tempo real e entrega um resumo direto no chat.
- **Exemplo:** `>pesquisa novidades do lançamento do GTA 6`

### `>imagem <descrição>`
Gera imagens artísticas com inteligência artificial via Pollinations ou Stability AI.
- **Exemplo:** `>imagem uma cidade cyberpunk à noite sob chuva neon, 4k`

### `>audio <pergunta>`
Pergunta algo para a Hikari e recebe a resposta sintetizada em áudio de voz natural no WhatsApp (PTT).
- **Exemplo:** `>audio me conte uma curiosidade sobre o espaço`

### `>falar <texto>`
Lê em voz alta o texto enviado, gerando um arquivo de áudio falado.
- **Exemplo:** `>falar bom dia grupo, que todos tenham uma excelente semana!`

### `>transcrever`
Transcreve o áudio anexado ou uma mensagem de voz que você esteja respondendo (quote/reply).
- **Uso:** Responda a um áudio com o comando `>transcrever`.

---

## 🖼️ 3. Figurinhas e Processamento de Imagens

### `>sticker [descrição]` / `>figurinha [descrição]`
Converte imagens, fotos, GIFs ou vídeos de até 10 segundos em figurinhas do WhatsApp (512×512) com transparência perfeita e sem cortes distorcidos.
- **Uso:** Envie uma foto/vídeo com a legenda `>sticker` ou responda a uma foto existente no chat. A descrição opcional define o texto embutido nos metadados do pacote.

### `>toimg` / `>sticker2image`
Converte uma figurinha recebida de volta para formato de imagem:
- **Figurinha Estática:** Retorna um arquivo PNG transparente com alta resolução.
- **Figurinha Animada:** Converte para um arquivo `.gif` completo com todos os frames preservados.
- **Uso:** Responda a uma figurinha no chat com o comando `>toimg`.

### `>anime`
Identifica a origem de uma cena de anime a partir de um print ou imagem.
- **Uso:** Envie uma imagem com a legenda `>anime` ou responda a uma imagem com o comando.
- **Retorno:** Nome do anime, episódio e minutagem aproximada da cena.

---

## 🎮 4. Jogos, Torrents e Consultas

### `>torrent <nome>` / `>buscar_jogo <nome>`
Busca repacks de jogos nos catálogos locais da FitGirl e DODI.
- **Exemplo:** `>torrent Dark Souls 3`
- **Retorno:** Uma lista numerada de até 5 resultados contendo título, tamanho e data.

### `>torrent <número>` (ou apenas o número em resposta)
Seleciona o item da busca anterior ou citada e envia o arquivo de texto `.txt` com o magnet link validado.
- **Exemplo:** Responda à lista da Hikari digitando apenas `1` ou `>torrent 1`.
- **Duração:** A lista fica indexada em memória por 10 minutos vinculada ao seu remetente.

### `>steam <nome>`
Consulta os dados oficiais de um jogo na loja da Steam.
- **Exemplo:** `>steam Portal 2`
- **Retorno:** Preço atual, desconto, desenvolvedora, plataformas e breve comentário da IA.

### `>moeda <valor> <DE> <PARA>`
Converte valores entre moedas fiduciárias ou criptomoedas em tempo real.
- **Exemplo:** `>moeda 50 USD BRL`
- **Exemplo Cripto:** `>moeda 1 BTC USD`
- **Retorno:** Valor convertido, cotação utilizada, fonte oficial e data do registro.

---

## 🎵 5. Downloads de Mídia e Música

### `>musica <nome e artista>`
Busca e faz o download de faixas de estúdio em alta qualidade (HQ MP3 / 320kbps) direto pelo catálogo Deezer via `deemix`.
- **Exemplo:** `>musica Bohemian Rhapsody Queen`
- **Retorno:** Arquivo de áudio MP3 enviado no chat com metadados e capa.

### `>baixar_audio <URL>`
Extrai e converte a trilha sonora de vídeos e áudios da internet para formato de áudio.
- **Exemplo:** `>baixar_audio https://www.youtube.com/watch?v=...`

### `>baixar_video <URL>`
Baixa vídeos da internet (YouTube Shorts, Instagram Reels, TikTok, Twitter/X) e envia diretamente no chat.
- **Exemplo:** `>baixar_video https://www.instagram.com/reel/...`

---

## 🛠️ 6. Comandos Utilitários de Chat

### `>limpar`
Limpa o histórico recente das 15 mensagens da conversa em memória.
- **No Privado:** Qualquer usuário pode executar para reiniciar sua sessão.
- **Em Grupos:** Apenas administradores do grupo ou o proprietário do bot podem acionar.

### `>ajuda`
Exibe a lista consolidada com as principais ferramentas e comandos rápidos da Hikari.

### `>termos`
Mostra detalhes transparentes sobre a política de dados, retenção de contexto e privacidade do bot.

---

## 👑 7. Comandos de Administração (Owner Only)

Estes comandos operam exclusivamente para os telefones configurados em `WHATSAPP_OWNER_NUMBERS`:

| Comando | Descrição |
| :--- | :--- |
| `>pausar` | Congela temporariamente o atendimento da Hikari a novas mensagens de usuários. |
| `>retomar` | Descongela o atendimento da Hikari e volta ao estado operacional normal. |
| `>fila` | Exibe o status da fila de mensagens, tarefas ativas e tamanho do processamento atual. |

---

## 💡 Dicas de Especialista

- 💡 **Acesso Rápido a Figurinhas:** Ao responder uma figurinha com `>toimg`, a Hikari gera a imagem em menos de 1 segundo. Se enviar uma foto com `>figurinha`, ela já é convertida diretamente.
- 💡 **Uso em Grupos:** Para evitar excesso de mensagens em grupos movimentados, o bot ignora falas comuns entre membros e só responde quando expressamente solicitado.

---

[🏠 Voltar ao Menu Principal](./README.md)

