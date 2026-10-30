# 🚀 Guia de Instalação e Início Rápido (Get Started)

Bem-vindo ao guia técnico de implantação da **HikariZap** (WhatsApp Edition). Este documento detalha os requisitos do sistema, a instalação de dependências, o pareamento com o WhatsApp via Baileys e a primeira execução.

---

## 📂 Sumário

1. [🖥️ 1. Requisitos do Sistema](#-1-requisitos-do-sistema)
2. [📥 2. Instalação Passo a Passo](#-2-instalação-passo-a-passo)
3. [🎮 3. Catálogos de Jogos (FitGirl & DODI)](#-3-catálogos-de-jogos-fitgirl--dodi)
4. [📱 4. Pareamento no WhatsApp & Execução](#-4-pareamento-no-whatsapp--execução)
5. [💡 Dicas de Especialista](#-dicas-de-especialista)

---

## 🖥️ 1. Requisitos do Sistema

Para uma operação estável e fluida, a máquina ou servidor deve atender aos seguintes parâmetros:

### ⚙️ Hardware e Sistema Operacional

- **SO:** Linux (Ubuntu 22.04 LTS / 24.04 LTS recomendado) ou Windows 10/11.
- **Node.js:** Versão **v20.x ou superior (LTS)**. O runtime utiliza a suíte nativa de testes `node:test` e módulos modernos do Node.
- **Memória RAM:** Mínimo de 1 GB livre (ideal 2 GB para processamento de figurinhas animadas em WebP e conversões de áudio).

### 📦 Dependências Externas do Sistema (Recomendadas)

Determinadas funções avançadas necessitam de utilitários instalados no PATH do sistema operacional:

1. **ffmpeg:** Necessário para conversão de áudio, geração de figurinhas animadas (vídeos de até 10s para WebP) e extração de áudio.
2. **yt-dlp:** Utilizado para download de vídeos e extração de trilhas sonoras da internet.
3. **Python 3.10+ (Opcional):** Necessário caso deseje utilizar o download oficial de músicas do Deezer em alta qualidade via biblioteca `deemix`.

---

## 📥 2. Instalação Passo a Passo

### ⚡ Método Rápido (Recomendado)

Na raiz do projeto existem scripts prontos que automatizam a verificação do ambiente e a instalação das dependências:

- **Windows:** Execute `setup.bat` com duplo clique ou rode no PowerShell:
  ```powershell
  .\setup.ps1
  ```
- **Linux:** Execute permissão e rode o script:
  ```bash
  chmod +x setup.sh
  ./setup.sh
  ```

---

### 🛠️ Método Manual

1. **Clonar o Repositório:**
   ```bash
   git clone https://github.com/yGuilhermy/HikariZap.git
   cd HikariZap
   ```

2. **Instalar Dependências do Node.js:**
   ```bash
   npm install
   ```

3. **(Opcional) Ambiente Virtual Python para Deezer:**
   Para habilitar downloads musicais pelo Deezer sem conflito de pacotes globais:
   - **Linux:**
     ```bash
     python3 -m venv .venv
     ./.venv/bin/pip install -r requirements.txt
     ```
   - **Windows:**
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\python.exe -m pip install -r requirements.txt
     ```

4. **Configuração de Variáveis de Ambiente:**
   Copie o arquivo de exemplo e configure suas chaves:
   ```bash
   cp .env_example .env
   ```
   Abra o `.env` e defina seu número em `WHATSAPP_OWNER_NUMBERS` (ex: `5511999999999`) e suas chaves de API (como `GEMINI_API_KEY`).

---

## 🎮 3. Catálogos de Jogos (FitGirl & DODI)

A funcionalidade de busca de repacks (`>torrent nome`) lê bibliotecas locais em formato JSON para fornecer respostas instantâneas sem dependência de APIs externas de terceiros:

- `src/data/fitgirl.json`
- `src/data/dodi.json`

Por motivos de direitos autorais e tamanho de arquivo, esses índices **não são incluídos no repositório**:

1. Acesse o portal da [Hydra Library](https://library.hydra.wiki/) ou exporte os catálogos correspondentes aos repacks da **FitGirl** e **DODI**.
2. Mova os arquivos JSON baixados para a pasta `src/data/` nomeando-os como `fitgirl.json` e `dodi.json`.
3. Reinicie a aplicação para que a Hikari carregue os catálogos locais em memória.

---

## 📱 4. Pareamento no WhatsApp & Execução

Após configurar o arquivo `.env`, inicialize a aplicação:

```bash
npm start
```

Ou diretamente pelo Node:

```bash
node index.js
```

### Processo de Conexão:

1. Na primeira execução, o terminal exibirá um **QR Code ASCII**.
2. Abra o WhatsApp no celular, toque no menu de três pontos (ou Ajustes no iOS) e selecione **Aparelhos conectados**.
3. Toque em **Conectar um aparelho** e aponte a câmera para o QR Code no terminal.
4. O Baileys autenticará a sessão e criará a pasta de credenciais seguras `.whatsapp-auth/`.
5. Assim que a conexão for confirmada, o log exibirá:
   `[SYSTEM] Login confirmado. Hikari Zap conectada; chats privados e grupos.`
6. Nas próximas inicializações, a conexão é restabelecida automaticamente em poucos segundos sem necessidade de novo QR Code.

---

## 💡 Dicas de Especialista

- 💡 **Trava de Instância:** O sistema possui uma trava de arquivo na pasta `.whatsapp-auth` que impede que duas instâncias rodem simultaneamente na mesma máquina, evitando desconexões cíclicas do WhatsApp.
- 💡 **Preservação de Sessão:** Nunca apague a pasta `.whatsapp-auth` a menos que queira deliberadamente desconectar o número da Hikari e conectar um novo aparelho.
- 💡 **Prevenção de Quedas em VPS:** Em servidores Linux, utilize o `tmux` ou `pm2` para manter o processo rodando continuamente em segundo plano:
  ```bash
  tmux new -s hikari "node index.js"
  ```
- 💡 **Verificação de Saúde:** O projeto conta com scripts nativos de diagnóstico sem precisar ligar o WhatsApp:
  ```bash
  npm run check
  npm run config:check
  npm test
  ```

---

[🏠 Voltar ao Menu Principal](./README.md)
