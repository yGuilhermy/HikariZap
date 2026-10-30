# 🛡️ Sistema de Segurança, Moderação e Privacidade

A HikariZap adota uma arquitetura orientada à privacidade, com isolamento de credenciais locais, sanitização ativa de dados confidenciais e controle administrativo rigoroso no WhatsApp.

---

## 📂 Sumário

1. [🔒 1. Privacidade e Isolamento de Dados](#-1-privacidade-e-isolamento-de-dados)
2. [🧹 2. Sanitização Ativa de Logs](#-2-sanitização-ativa-de-logs)
3. [👑 3. Comandos Administrativos do Proprietário](#-3-comandos-administrativos-do-proprietário)
4. [🚦 4. Proteção de Taxa e Prevenção de Bloqueios](#-4-proteção-de-taxa-e-prevenção-de-bloqueios)
5. [💡 Dicas de Moderação e Segurança](#-dicas-de-moderação-e-segurança)

---

## 🔒 1. Privacidade e Isolamento de Dados

A segurança da instância começa pelo não armazenamento de informações pessoais desnecessárias:

- **Sem Registro de Chats em Log:** O logger central da aplicação não grava o conteúdo de mensagens comuns, áudios transcritos ou conversas privadas nos arquivos de log.
- **Contexto Volátil e Limitado:** O histórico recente das conversas é mantido em memória até o limite de 15 mensagens por chat para permitir coerência conversacional. Não existem bancos de dados de histórico que acumulem conversas de longo prazo em texto aberto.
- **Isolamento de Caches:** Arquivos temporários de mídia, stickers e downloads residem na pasta local configurada e são purgados automaticamente logo após a entrega ao WhatsApp.

---

## 🧹 2. Sanitização Ativa de Logs

O sistema de logging (`src/utils/logger.js`) intercepta todas as saídas de depuração e erro antes de gravá-las no console ou nos arquivos diários em `logs/`:

- **Ocultação de Chaves de API:** Qualquer string com formato de chave de API conhecida (como tokens do Gemini com prefixo `AIza...`, tokens Hugging Face `hf_...` ou tokens de bearer) é automaticamente substituída pela máscara `[REDACTED]`.
- **Ocultação de Identificadores Sensíveis:** Telefones, LIDs e credenciais do Baileys são ocultados nas saídas de diagnóstico.
- **QR Code Seguro:** O QR Code de pareamento é renderizado exclusivamente no terminal interativo e nunca gravado em disco ou exposto via web.

---

## 👑 3. Comandos Administrativos do Proprietário

Os comandos abaixo são restritos aos telefones autorizados no arquivo `.env` (`WHATSAPP_OWNER_NUMBERS`):

### `>pausar`
Congela instantaneamente o atendimento da Hikari. O bot continua online no WhatsApp, mas recusa novos pedidos com aviso de manutenção.

### `>retomar`
Restaura a operação normal após uma pausa administrativa.

### `>fila`
Exibe a situação da fila de trabalho: tarefas aguardando envio, processos em andamento e tempo médio de resposta.

---

## 🚦 4. Proteção de Taxa e Prevenção de Bloqueios

O Baileys é um cliente não oficial de conexão ao protocolo do WhatsApp. Para proteger o chip e a conta contra restrições ou bloqueios:

- **Serialização Obrigatória:** A Hikari nunca dispara mensagens simultâneas em massa no mesmo segundo. O despachador mantém uma pausa técnica mínima entre mensagens.
- **Limitação por Conversa:** Cada chat individual tem uma cota máxima de 6 envios por minuto.
- **Desconexão Controlada:** Caso o WhatsApp reporte desconexão por logout no celular ou conflito de dispositivo, a Hikari interrompe a sessão de forma segura sem tentar novo pareamento em loop infinito.

---

## 💡 Dicas de Moderação e Segurança

- 💡 **Proteção de Chip Novo:** Se estiver utilizando um número recém-cadastrado no WhatsApp, utilize-o manualmente por alguns dias antes de conectar o bot para criar reputação orgânica na rede.
- 💡 **Gestão de Grupos Grandes:** Em grupos com centenas de membros, oriente os participantes a mencionarem a Hikari apenas quando desejarem sua ajuda direta, mantendo o ambiente limpo e sem poluição.
- 💡 **Backup Seguro:** Mantenha um backup seguro da pasta `.whatsapp-auth` em local protegido caso precise migrar de servidor.

---

[🏠 Voltar ao Menu Principal](./README.md)
