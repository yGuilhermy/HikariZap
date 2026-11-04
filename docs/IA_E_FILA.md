# Modelos de IA e fila

A fila atende até duas conversas distintas simultaneamente, mantendo apenas um pedido ativo por conversa. Limites padrão: 20 pendentes globais, quatro por chat, espera máxima de 60 segundos e execução máxima de 180 segundos. Pedidos expirados não são executados; cancelamentos e prazos abortam o sinal e liberam o atendimento. Operações externas que ignorem cancelamento podem terminar internamente, mas não podem enviar a resposta após o sinal abortar.

A seleção de IA intercala Groq, Gemini e Hugging Face em vez de percorrer todas as chaves de todos os modelos Gemini antes de tentar outro provedor. Um destino que acabou de funcionar é preferido por um minuto. Há no máximo oito tentativas por conclusão, duas por provedor, até dez segundos por tentativa e 35 segundos para obter uma conclusão. O agente completo tem orçamento de 90 segundos. Não há espera de retry dentro da requisição: o destino em pausa é ignorado e outro provedor é tentado.

429 pausa o modelo antes de reavaliar sua cota; 5xx/503 introduzem espera progressiva por modelo; falhas de rede pausam o serviço; 401/403/402 pausam a credencial; 404 pausa a combinação de modelo e credencial; parâmetros de ferramentas incompatíveis não desativam o uso textual desse modelo. Retry-After e RetryInfo são respeitados. Não é criada cota, ativada cobrança nem removida restrição de projeto. As pausas são compartilhadas com visão e transcrição Gemini.

O estado operacional fica em src/data/zap/ai-health.json: contém somente identificadores de serviço/modelo, hash de credencial, classe da falha e prazo da pausa. Não contém chaves, prompts ou respostas. O log de cada tentativa informa provedor, modelo e orçamento, sem registrar a credencial.

GEMINI_MODELS, GROQ_MODELS e HF_MODELS definem as listas ordenadas. Os modelos configurados foram consultados nos catálogos das APIs em 04/11/2026; constar no catálogo não garante cota ou autorização de inferência. Groq reutiliza GROQ_API_KEY ou pode ter uma chave separada em GROQ_CHAT_API_KEY. Pollinations exige chave por padrão; o endpoint público só entra com ALLOW_PUBLIC_POLLINATIONS=true.

Modelos Gemini configurados: gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash e gemini-3.5-flash. Groq: openai/gpt-oss-20b, openai/gpt-oss-120b e qwen/qwen3.8-27b. Hugging Face: Qwen/Qwen3.8-27B, openai/gpt-oss-20b e meta-llama/Llama-3.1-8B-Instruct. GEMINI_MODEL_FALLBACK_2 e _3 são mantidos por compatibilidade; GEMINI_MODELS, quando preenchido, prevalece.

Controles: AI_PROVIDER_ORDER, LLM_ATTEMPT_TIMEOUT_MS, LLM_COMPLETION_BUDGET_MS, LLM_AGENT_BUDGET_MS, LLM_MAX_ATTEMPTS, LLM_MAX_PROVIDER_ATTEMPTS, LLM_MAX_OUTPUT_TOKENS, QUEUE_CONCURRENCY, QUEUE_MAX_PENDING, QUEUE_MAX_PER_CHAT, QUEUE_WAIT_TIMEOUT_MS e QUEUE_TASK_TIMEOUT_MS. O aviso de congestionamento ou indisponibilidade é limitado a uma mensagem por chat a cada 30 segundos.

Referências: https://aistudio.google.com/docs/troubleshooting e https://console.groq.com/docs/reasoning .

Nas chamadas de diagnóstico autorizadas, Groq respondeu texto e function calling; Gemini apresentou alta demanda/timeout e Hugging Face exigiu créditos. Por isso AI_PROVIDER_ORDER prioriza Groq. Nenhuma conexão WhatsApp é aberta para esses diagnósticos.

## Resultado da validação em 04/11/2026

- Verificação de sintaxe e diagnóstico de configuração: aprovados.
- Suíte local com provedores simulados: 68 testes aprovados, nenhuma falha.
- API Groq: gpt-oss-20b, gpt-oss-120b e qwen3.8-27b responderam às solicitações curtas. O loop real do agente completou chamada de ferramenta simulada e resposta final sem WhatsApp.
- Gemini: foram observados 503/alta demanda e timeout nos modelos testados; nos logs anteriores também aparecem 429/cota, 403/projeto sem acesso ao nível gratuito e 404/modelos antigos indisponíveis.
- Hugging Face: retornou 402 por falta de créditos de inferência. O código não altera cobrança ou cota.
- Nenhuma nova conexão WhatsApp foi aberta durante a validação. O processo existente não foi reiniciado; carregará a nova implementação no próximo início autorizado.

Os testes locais usam diretórios temporários; os diagnósticos por API usam prompts artificiais, sem conteúdo das conversas. A disponibilidade futura depende de cota e estado dos provedores.
