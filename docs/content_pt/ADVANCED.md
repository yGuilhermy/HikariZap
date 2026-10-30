# 🛠️ Sistema de Ferramentas e Arquitetura Avançada

Este guia é voltado para desenvolvedores e entusiastas que desejam entender as entranhas da HikariZap, seu transporte Baileys, o sistema local de Function Calling (Tools) e como criar novas capacidades para a IA.

---

## 📂 Sumário

1. [🧰 1. Como Funcionam as "Tools" (Function Calling Local)](#-1-como-funcionam-as-tools-function-calling-local)
2. [🤖 2. Catálogo de Ferramentas Nativas](#-2-catálogo-de-ferramentas-nativas)
3. [🔌 3. Transporte Baileys e Gestão de Conexão](#-3-transporte-baileys-e-gestão-de-conexão)
4. [👥 4. Mapeamento PN / LID e Identidades](#-4-mapeamento-pn--lid-e-identidades)
5. [🚦 5. Fila Serializada e Proteção de Envio](#-5-fila-serializada-e-proteção-de-envio)
6. [📂 6. Como Criar uma Nova Ferramenta?](#-6-como-criar-uma-nova-ferramenta)
7. [💡 Dicas de Desenvolvimento](#-dicas-de-desenvolvimento)

---

## 🧰 1. Como Funcionam as "Tools" (Function Calling Local)

Diferente de implementações pesadas que dependem de processos externos de Model Context Protocol (MCP) em background, a HikariZap utiliza **Function Calling nativo e local** compatível com o padrão OpenAI e Gemini:

### O Ciclo Técnico:
1. **Declaração do Esquema:** As assinaturas das funções estão descritas no arquivo `src/data/mcp_tools.json` seguindo a especificação JSON Schema.
2. **Envio ao Provedor:** Durante o loop em `src/handlers/llmHandler.js`, o catálogo é injetado na chamada com `tool_choice: "auto"`.
3. **Interceptação:** Quando o modelo decide que precisa de dados do mundo real, ele retorna um objeto com `tool_calls` contendo o nome da ferramenta e os argumentos estruturados.
4. **Execução:** O executor local (`src/whatsapp/tools.js`) despacha a função para o respectivo serviço (ex: `convert_currency`, `search_web`, `create_sticker`).
5. **Feedback Cognitivo:** O retorno da ferramenta é devolvido ao modelo em uma rodada seguinte, permitindo que a IA complete a resposta de forma natural para o usuário.

---

## 🤖 2. Catálogo de Ferramentas Nativas

O catálogo `src/data/mcp_tools.json` expõe as seguintes funções para a IA:

| Ferramenta | Parâmetros Principais | Ação Executada |
| :--- | :--- | :--- |
| `search_web` | `query` (string) | Realiza busca semântica na web e retorna trechos limpos de sites. |
| `convert_currency` | `amount`, `from`, `to` | Converte valores monetários usando a cotação oficial em tempo real. |
| `check_steam` | `game` (string) | Consulta a loja da Steam e recupera dados de preço, gênero e desconto. |
| `search_game` | `query` (string) | Pesquisa nos catálogos locais FitGirl e DODI e retorna até 5 repacks. |
| `download_game_torrent`| `result_index` (número) | Valida o infohash e envia o magnet link como arquivo `.txt` no WhatsApp. |
| `create_sticker` | `description` (opcional) | Converte a imagem citada ou anexada em figurinha 512×512 com padding. |
| `identify_anime` | *(Imagem anexada/citada)* | Consulta a API Trace.moe para identificar frame de animação japonesa. |
| `text_to_speech` | `text` (string) | Sintetiza voz falada (TTS) para responder dúvidas em formato de áudio PTT. |
| `generate_image` | `prompt` (string) | Gera artes visuais via difusão de imagens. |

---

## 🔌 3. Transporte Baileys e Gestão de Conexão

O transporte do WhatsApp é implementado em `src/whatsapp/client.js` sobre o socket do Baileys:

- **Trava de Instância (Lockfile):** Utiliza um arquivo `instance.lock` dentro de `.whatsapp-auth` para garantir que apenas um processo gerencie a conta por vez.
- **Estratégia de Reconexão Exponencial:** Em caso de desconexão momentânea, o bot tenta reconectar até 5 vezes com esperas graduais de 10 a 120 segundos. O contador só zera após 2 minutos de conexão contínua estável.
- **Isolamento de Erros:** Quedas de conexão ou limitação de taxa nunca derrubam a aplicação; o socket é recriado de maneira controlada preservando os caches de identidade e contexto.

---

## 👥 4. Mapeamento PN / LID e Identidades

O WhatsApp moderno opera com telefones (PN - Phone Number) e identidades de aparelhos vinculados (LID - Linked Device):

- **Aprendizado Técnico:** A Hikari não vasculha contatos nem solicita listas completas. Ela mapeia o par `PN <-> LID` unicamente quando mensagens autênticas são recebidas pelo socket.
- **Persistência Segura:** O arquivo `src/data/zap/identities.json` mantém a tabela de correspondência.
- **Blindagem de Permissões:** O sistema de governança (`isOwner`) nunca confia cegamente em um LID desconhecido. Se um usuário interagir usando LID sem um telefone previamente autenticado na lista de donos, privilégios administrativos são sumariamente negados.

---

## 🚦 5. Fila Serializada e Proteção de Envio

Para evitar bloqueios de spam pelo WhatsApp, a classe `Queue` em `src/whatsapp/queue.js` implementa um controle de fluxo inteligente:

- **Espaçamento Mínimo:** Intervalo de 2 segundos entre envios sucessivos no mesmo chat.
- **Limites Locais:** Máximo de 20 mensagens por minuto globalmente e 6 mensagens por conversa individual.
- **Tratamento de Mensagens Longas:** Se a IA produzir uma resposta muito extensa, o texto é truncado com segurança em 24.000 caracteres antes do envio para não estourar o limite de payload do Baileys.

---

## 📂 6. Como Criar uma Nova Ferramenta?

Adicionar uma nova capacidade à IA é um processo simples em 2 etapas:

### 1. Registrar a Ferramenta no JSON (`src/data/mcp_tools.json`)
Adicione a definição no array de ferramentas:

```json
{
  "type": "function",
  "function": {
    "name": "consultar_cep",
    "description": "Consulta o endereço completo a partir de um CEP brasileiro de 8 dígitos.",
    "parameters": {
      "type": "object",
      "properties": {
        "cep": {
          "type": "string",
          "description": "O CEP a ser pesquisado, contendo 8 dígitos."
        }
      },
      "required": ["cep"]
    }
  }
}
```

### 2. Implementar a Ação no Executor (`src/whatsapp/tools.js`)
No switch do executor de ferramentas, conecte o serviço correspondente:

```javascript
case 'consultar_cep': {
    const { data } = await axios.get(`https://viacep.com.br/ws/${encodeURIComponent(args.cep)}/json/`);
    if (data.erro) return { error: 'CEP não encontrado.' };
    return { logradouro: data.logradouro, bairro: data.bairro, cidade: data.localidade, uf: data.uf };
}
```

Ao reiniciar a aplicação, a IA já terá total conhecimento da nova ferramenta e a utilizará automaticamente quando solicitada em conversas naturais.

---

## 💡 Dicas de Desenvolvimento

- 💡 **Rastreamento de Pensamento:** Ao rodar no terminal com `LOG_LEVEL=debug`, a Hikari imprime os pensamentos intermediários do modelo e o disparo de cada ferramenta com seus argumentos e tempos de resposta.
- 💡 **Isolamento por Try/Catch:** Toda ferramenta externa deve ser encapsulada em blocos protegidos para garantir que falhas em APIs terceiras retornem uma mensagem de erro à IA sem causar travamento na fila do WhatsApp.
- 💡 **Testes Unitários:** Ao adicionar ou modificar ferramentas, adicione o caso de teste em `tests/zap/` e valide o comportamento rodando `npm test`.

---

[🏠 Voltar ao Menu Principal](./README.md)

