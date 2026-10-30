# ⚙️ Configuração, Governança e Multi-Token

Este documento detalha a arquitetura de configuração da HikariZap, o sistema de validação estrita na inicialização, a governança de proprietários no WhatsApp e a resiliência com rotação de chaves de IA.

---

## 📂 Sumário

1. [🛡️ 1. Validação Estrita na Inicialização](#-1-validação-estrita-na-inicialização)
2. [👑 2. Sistema de Governança (WhatsApp Multi-Owner & PN/LID)](#-2-sistema-de-governança-whatsapp-multi-owner--pnlid)
3. [🔑 3. Arquitetura de IA Multi-Token & Rotação de Modelos](#-3-arquitetura-de-ia-multi-token--rotação-de-modelos)
4. [💱 4. Provedores de Câmbio e Moedas](#-4-provedores-de-câmbio-e-moedas)
5. [📑 5. Estrutura Centralizada (`src/config/index.js`)](#-5-estrutura-centralizada-srcconfigindexjs)
6. [💡 Dicas de Configuração Avançada](#-dicas-de-configuração-avançada)

---

## 🛡️ 1. Validação Estrita na Inicialização

A HikariZap não utiliza arquivos JSON secundários para configurações secretas. A única fonte da verdade é o arquivo `.env` na raiz da aplicação.

Antes de abrir a conexão do Baileys ou enviar requisições para a internet, o validador interno (`src/config/validate.js`) analisa:
- **Formato de Números:** Verifica se os números em `WHATSAPP_OWNER_NUMBERS` possuem de 8 a 15 dígitos com DDI e DDD válidos. Números genéricos de exemplo como `5500000000000` são rejeitados na autorização.
- **Limites de Mídia:** `WHATSAPP_MAX_MEDIA_MB` deve estar entre 1 e 64 MB.
- **Limites de Voz:** Velocidade de 0,5 a 2; temperatura de 0 a 2; limite de 1 a 5.000 caracteres.
- **Limites de Logs:** Retenção de 1 a 90 dias e rotação de 1 a 50 MB por arquivo.
- **Validação de Executáveis:** Confere a existência do FFmpeg e yt-dlp sem travar a inicialização se apenas funções opcionais estiverem ausentes.

Se houver erros graves de formato, o bot interrompe a inicialização e aponta o campo exato sem expor o valor secreto nos logs.

---

## 👑 2. Sistema de Governança (WhatsApp Multi-Owner & PN/LID)

### Configuração de Proprietários
No arquivo `.env`, preencha `WHATSAPP_OWNER_NUMBERS` com um ou mais telefones completos (com código de país DDI e DDD), separados por vírgula:

```env
WHATSAPP_OWNER_NUMBERS=5511999999999,5521988888888
```

### Segurança contra Spoofing de LID
O WhatsApp utiliza dois identificadores:
- **PN (Phone Number JID):** O identificador real com o número de telefone (ex: `5511999999999@s.whatsapp.net`).
- **LID (Linked Device JID):** Um identificador opaco atribuído pelo WhatsApp (ex: `123456789@lid`).

A Hikari mantém um cache técnico seguro em `src/data/zap/identities.json` alimentado exclusivamente por eventos oficiais recebidos do WhatsApp. Um LID desconhecido pode interagir como usuário comum no chat, mas **nunca recebe privilégios de proprietário** até que seu telefone correspondente seja comprovado em uma mensagem autêntica.

Comandos restritos ao proprietário (como `>pausar`, `>retomar`, `>fila`) exigem validação completa do número autorizado.

---

## 🔑 3. Arquitetura de IA Multi-Token & Rotação de Modelos

Para contornar limites de taxa (Rate Limits) e indisponibilidade de APIs, a Hikari adota um algoritmo inteligente de múltiplos provedores e fallbacks em cascata:

### Rotação de Chaves Gemini
Você pode configurar múltiplas chaves de API da Google separadas por vírgula no `.env`:

```env
GEMINI_API_KEY=AIzaSyA...,AIzaSyB...,AIzaSyC...
```

### Ordem de Fallback de Modelos:
A cada novo pedido, a Hikari executa a consulta na seguinte prioridade:
1. **IA Local (Opcional):** Se `LOCAL_LLM_ENABLED=true`, tenta primeiro o servidor local (LM Studio ou Ollama em `LOCAL_LLM_URL`).
2. **Modelo Principal Gemini:** `GEMINI_MODEL` (Padrão: `gemini-3.1-flash-lite`), testando cada chave configurada em ordem.
3. **Primeiro Fallback Gemini:** `GEMINI_MODEL_FALLBACK` (Padrão: `gemini-3.5-flash-lite`).
4. **Segundo Fallback Gemini:** `GEMINI_MODEL_FALLBACK_2` (Padrão: `gemini-2.5-flash-lite`).
5. **Terceiro Fallback Gemini:** `GEMINI_MODEL_FALLBACK_3` (Padrão: `gemini-2.5-flash`).
6. **Hugging Face:** Se todos os modelos Gemini falharem, aciona o modelo configurado em `HF_MODEL` via `HF_TOKEN`.
7. **Pollinations AI:** Fallback de contingência final para garantir resposta contínua.

Modelos duplicados na cadeia de configuração são executados uma única vez.

---

## 💱 4. Provedores de Câmbio e Moedas

A conversão monetária (`>moeda`) realiza consultas sob demanda sem depender de arquivos de cache locais obsoletos:

- **AwesomeAPI (`CURRENCY_PROVIDER=awesomeapi`):** Provedor padrão gratuito, com suporte a cotações em tempo real de dezenas de moedas e criptomoedas. A variável opcional `AWESOMEAPI_KEY` permite autenticação via cabeçalho para planos sem cache de provedor.
- **Frankfurter (`CURRENCY_PROVIDER=frankfurter`):** Provedor baseado nos dados oficiais do Banco Central Europeu para taxas de referência diárias, sem exigência de chave de API.

Todas as respostas de câmbio informam expressamente o horário da cotação e a fonte oficial dos dados.

---

## 📑 5. Estrutura Centralizada (`src/config/index.js`)

| Propriedade | Fonte (.env) | Descrição |
| :--- | :--- | :--- |
| `botName` | `BOT_NAME` | Nome que ativa a Hikari nas conversas e grupos. |
| `ownerNumbers` | `WHATSAPP_OWNER_NUMBERS` | Lista de telefones com privilégios administrativos. |
| `notifyOwner` | `WHATSAPP_NOTIFY_OWNER` | Se `true`, envia alertas de conexão ao proprietário. |
| `systemPrompt` | `SYSTEM_PROMPT` | Diretriz mestre que define a personalidade e as regras de fala da IA. |
| `authDir` | `WHATSAPP_AUTH_DIR` | Pasta onde as credenciais da sessão são salvas (Padrão: `.whatsapp-auth`). |
| `dataDir` | `WHATSAPP_DATA_DIR` | Pasta onde ficam caches técnicos de mensagens e identidades. |
| `maxMediaMb` | `WHATSAPP_MAX_MEDIA_MB` | Tamanho máximo permitido para envio de arquivos pelo bot. |
| `logLevel` | `LOG_LEVEL` | Nível de detalhamento dos logs (`debug`, `info`, `warn`, `error`). |

---

## 💡 Dicas de Configuração Avançada

- 💡 **Diagnóstico Prévio:** Rode `npm run config:check` antes de subir o bot para verificar se todas as variáveis estão preenchidas corretamente.
- 💡 **Personalidade Neutra no WhatsApp:** O `SYSTEM_PROMPT` padrão instrui a Hikari a responder de forma concisa e natural pelo WhatsApp, evitando saudações repetitivas ou poluição visual.
- 💡 **Sanitização de Logs:** O sistema mascara automaticamente tokens de API, cookies, telefones e identificadores nas saídas de console e nos arquivos de log diários gravados em `logs/`.

---

[🏠 Voltar ao Menu Principal](./README.md)

