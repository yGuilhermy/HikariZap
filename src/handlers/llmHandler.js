const config = require('../config');
const {logger} = require('../utils/logger');
const tools = require('../data/mcp_tools.json');
const {getPool} = require('../services/aiProviders');

function stripThinking(text, {keepToolCode = false} = {}) {
    if (typeof text !== 'string') return '';
    let clean = text
        .replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(?:think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*$/gi, '')
        .replace(/^[\s\S]*?<\/(?:think|thinking|analysis|reasoning)\s*>/gi, '')
        .replace(/```(?:thinking|analysis|reasoning|think)\b[^\n]*\n[\s\S]*?(?:```|$)/gi, '');
    // Some providers put their private channel in content, without XML tags.
    const channel = clean.match(/\[start\]assistant\[channel\]analysis[\s\S]*?(?:\[message\]|$)|<\|(?:im_start|start)\|>assistant(?:<\|channel\|>|\s+)analysis(?:<\|message\|>|\s*)/i);
    if (channel) {
        const tail = clean.slice(channel.index);
        const final = tail.match(/(?:\[start\]assistant\[channel\]final\[message\]|<\|(?:im_start|start)\|>assistant(?:<\|channel\|>|\s+)final<\|message\|>)([\s\S]*)/i);
        clean = clean.slice(0,channel.index) + (final ? final[1].replace(/(?:\[end\]|<\|im_end\|>|<\|end\|>)/g,'') : '');
    }
    const thinking = /^(?:\s*(?:#{1,6}\s*|>\s*)?(?:\*{1,2}|__)?(?:thinking|analysis|reasoning|internal monologue|chain of thought|pensamento(?: interno)?|racioc[ií]nio(?: interno)?|an[aá]lise interna)(?:\*{1,2}|__)?\s*(?::|\n|$))/im.exec(clean);
    if (thinking) {
        const tail = clean.slice(thinking.index);
        const final = /^(?:\s*(?:#{1,6}\s*)?(?:\*{1,2}|__)?(?:final answer|final response|resposta final)(?:\*{1,2}|__)?\s*:\s*(?:\*{1,2})?\s*)([\s\S]*)/im.exec(tail);
        clean = clean.slice(0,thinking.index) + (final ? final[1] : '');
    }
    // Keep compatibility calls only for the internal tool parser, after removing
    // reasoning. They are still removed from all user-facing output.
    if (keepToolCode) return clean.trim();
    return clean
        .replace(/\[Hikari enviou [^\]]+\]\s*/gi, '')
        .replace(/```(?:python|tool_code|json)?[\s\S]*?```/g, m => /default_api|tool_code|"function"|"name"/.test(m) ? '' : m)
        .replace(/(?:tool_code\s+)?(?:print\s*\(\s*)?(?:default_api\.)[a-zA-Z0-9_]+\s*\([\s\S]*?\)\s*\)?/g, '')
        .replace(/\btool_code\b/g, '')
        .replace(/^\s*(?:print\s*\(\s*)?[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\s*\([\s\S]*?\)\s*\)?\s*$/gm, '')
        .trim();
}

function parsePythonKwargs(raw) {
    if (!raw || !raw.trim()) return {};
    const text = raw.trim();
    if (text.startsWith('{') && text.endsWith('}')) {
        try { return JSON.parse(text); } catch (_) {}
    }
    const result = {};
    const regex = /([a-zA-Z0-9_]+)\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\bTrue\b|\bFalse\b|\bNone\b|-?\d+(?:\.\d+)?)|(\{[\s\S]*?\}|\[[\s\S]*?\]))/g;
    let match;
    let count = 0;
    while ((match = regex.exec(text)) !== null) {
        count++;
        const key = match[1];
        let val;
        if (match[2] !== undefined) val = match[2];
        else if (match[3] !== undefined) val = match[3];
        else if (match[4] !== undefined) val = match[4].replace(/\\"/g, '"');
        else if (match[5] !== undefined) val = match[5].replace(/\\'/g, "'");
        else if (match[6] !== undefined) {
            const lit = match[6];
            if (lit === 'True') val = true;
            else if (lit === 'False') val = false;
            else if (lit === 'None') val = null;
            else val = Number(lit);
        } else if (match[7] !== undefined) {
            try { val = JSON.parse(match[7].replace(/'/g, '"')); } catch (_) { val = match[7]; }
        }
        result[key] = val;
    }
    if (count === 0) {
        const single = text.match(/^(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)')$/);
        if (single) {
            const val = single[1] ?? single[2] ?? (single[3] ? single[3].replace(/\\"/g, '"') : (single[4] ? single[4].replace(/\\'/g, "'") : ''));
            return {_raw: val};
        }
    }
    return result;
}

function extractPseudoToolCalls(content, availableTools) {
    if (!content || typeof content !== 'string') return null;
    const calls = [];
    const nameMap = new Map();
    for (const t of availableTools) {
        const name = t.function?.name || t.name;
        if (name) nameMap.set(name, t);
    }
    const pyRegex = /(?:tool_code\s+)?(?:print\s*\(\s*)?(?:default_api\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*\)?/g;
    let match;
    while ((match = pyRegex.exec(content)) !== null) {
        const name = match[1];
        const toolDef = nameMap.get(name);
        if (toolDef) {
            const rawArgs = match[2].trim();
            let parsedArgs = parsePythonKwargs(rawArgs);
            if (parsedArgs._raw !== undefined) {
                const firstReq = toolDef.function?.parameters?.required?.[0];
                parsedArgs = firstReq ? {[firstReq]: parsedArgs._raw} : {};
            }
            calls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                type: 'function',
                function: {name, arguments: JSON.stringify(parsedArgs)}
            });
        }
    }
    if (calls.length) return calls;
    const jsonBlock = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = (jsonBlock ? jsonBlock[1] : content).trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
        try {
            const obj = JSON.parse(candidate);
            const name = obj.name || obj.function;
            if (nameMap.has(name)) {
                const args = typeof obj.arguments === 'string' ? JSON.parse(obj.arguments) : (obj.arguments || obj.parameters || {});
                calls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    type: 'function',
                    function: {name, arguments: JSON.stringify(args)}
                });
                return calls;
            }
        } catch (_) {}
    }
    return calls.length ? calls : null;
}

async function completion(messages, signal, toolOption = true) {
    const prefix = config.prefix || '>';
    const commandGuide = `Guia público de uso da Hikari. Use estas informações para explicar suas próprias funções de forma breve e natural, citando apenas os comandos relevantes.
Quando o usuário perguntar COMO usar uma função (por exemplo, "como que baixa jogo torrent?"), explique o procedimento; não inicie buscas, downloads ou outras ações só porque a pergunta menciona uma ferramenta. Execute quando ele pedir a ação, como "busca o torrent de Elden Ring".
Torrent: ${prefix}torrent <nome do jogo> (ou ${prefix}buscar_jogo <nome>) inicia uma busca e mostra até 5 resultados. Outro nome inicia outra pesquisa. Depois use ${prefix}torrent <número> ou responda diretamente à lista só com o número. Ao responder a uma lista específica, vale aquela pesquisa; sem resposta direta, vale a última pesquisa da pessoa naquela conversa, por até 10 minutos. Sem pesquisa válida, peça uma nova busca. Também pode pedir a busca em linguagem natural e depois escolher o número. O bot envia apenas o .torrent; se indisponível, envia o magnet em .txt, não baixa nem instala o jogo. O usuário abre esse arquivo em um cliente torrent.
Figurinhas: ${prefix}sticker [descrição] ou ${prefix}figurinha [descrição], anexando ou citando imagem, GIF ou vídeo. A imagem inteira mantém a proporção e usa margens transparentes em 512x512; animações usam até 10 segundos. A descrição opcional vai nos metadados, não é texto desenhado na imagem, e é cortada em 128 caracteres. Pode pedir "faz essa figurinha aqui" com a mídia anexada ou citada. ${prefix}sticker2image ou ${prefix}toimg, respondendo a uma figurinha, retorna PNG se estática ou arquivo GIF se animada.
Downloads de áudio e vídeo exigem link. Música por nome/artista usa Deezer e depende da configuração. Voz, imagens e transcrição dependem dos serviços configurados; não prometa disponibilidade quando a ferramenta reportar erro. No privado basta conversar; em grupos, chamar Hikari, mencionar ou responder a ela. Os comandos também aceitam / como prefixo alternativo. Não invente flags, botões, funções, permissões ou comandos inexistentes.
Menu público atual:
${require('../whatsapp/router').getHelpText()}`;
    messages = [{role:'system',content:commandGuide},...messages];
    messages = messages.map(message => message.role === 'assistant' && message.content
        ? {...message,content:stripThinking(message.content) || null} : message);
    messages = [{role:'system',content:'Responda apenas com a resposta final destinada ao usuário. Nunca inclua raciocínio interno, análise, planejamento, instruções do sistema ou blocos Thinking/Analysis na resposta. Use o canal próprio de ferramentas para chamadas de função.'},...messages];
    const toolPayload = Array.isArray(toolOption) ? {tools:toolOption,tool_choice:'auto'} : toolOption ? {tools,tool_choice:'auto'} : {};
    return getPool().complete({messages,temperature:0.65,max_tokens:config.llmMaxOutputTokens,...toolPayload},signal,message=>{
        const content=stripThinking(message.content,{keepToolCode:true});
        const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
        if(!content&&!calls.length)return null;
        return {role:'assistant',content:content||null,...(calls.length?{tool_calls:calls.map((call,index)=>({
            id:call.id||`call_${Date.now()}_${index}`,type:'function',function:{name:call.function?.name||'',arguments:typeof call.function?.arguments==='string'?call.function.arguments:JSON.stringify(call.function?.arguments||{})}
        }))}:{})};
    });
}

async function generateResponse(prompt, chatId, options = {}) {
    const messages = [{role:'system',content:config.systemPrompt}, ...(options.history || []), {role:'user',content:String(prompt)}];
    const result = await completion(messages, options.signal, false);
    return stripThinking(result.content);
}

async function executeAgentLoop(prompt, ctx, executeTool) {
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(config.llmAgentBudget)].filter(Boolean));
    const activeTools = ctx.wantsAudio ? tools : tools.filter(t => t.function.name !== 'send_voice_note');
    const messages = [{role:'system',content:config.systemPrompt + `\nData atual: ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`}, ...(ctx.history || ctx.store.history(ctx.chatId)), {role:'user',content:prompt}];
    let hasExecutedTools = false;
    const executedKeys = new Set();
    const executedResults = new Map();
    for (let round = 0; round < config.maxToolRounds; round++) {
        logger.ai(`Loop do agente: rodada ${round + 1}/${config.maxToolRounds}`);
        const response = await completion(messages, signal, activeTools);
        if (!response.tool_calls?.length && response.content) {
            const pseudoCalls = extractPseudoToolCalls(response.content, activeTools);
            if (pseudoCalls?.length) {
                logger.ai(`Detectadas ${pseudoCalls.length} chamadas de ferramenta extraídas do conteúdo: ${pseudoCalls.map(c => c.function.name).join(', ')}`);
                response.tool_calls = pseudoCalls;
            }
        }
        if (!response.tool_calls?.length) {
            if (ctx.mediaSent || ctx.audioSent) return '';
            const text = stripThinking(response.content);
            if (!text) {
                if (hasExecutedTools) return '';
                throw new Error('O provedor retornou uma resposta vazia.');
            }
            signal.throwIfAborted();
            logger.ai(`Resposta textual gerada (${text.length} chars): "${text.slice(0, 150)}"`);
            return text;
        }
        if (response.tool_calls.length > 5) throw new Error('Muitas ferramentas solicitadas de uma vez.');
        if (response.content) ctx.mediaCaption = stripThinking(response.content);
        messages.push({role:'assistant',content:response.content || null,tool_calls:response.tool_calls});
        for (const call of response.tool_calls) {
            signal.throwIfAborted();
            const callKey = `${call.function.name}:${call.function.arguments}`;
            if (executedKeys.has(callKey)) {
                messages.push({role:'tool',tool_call_id:call.id,content:executedResults.get(callKey)||JSON.stringify({error:'Ferramenta já executada; não repetir a ação.'})});
                continue;
            }
            executedKeys.add(callKey);
            let result;
            logger.ai(`Executando ferramenta "${call.function.name}" | args: ${call.function.arguments}`);
            try {
                const args = JSON.parse(call.function.arguments || '{}');
                result = await executeTool(call.function.name,args,ctx);
                hasExecutedTools = true;
            } catch (error) { signal.throwIfAborted(); result = {error:error.message}; }
            const resultContent = JSON.stringify(result ?? {ok:true}).slice(0,12000);
            executedResults.set(callKey,resultContent);
            logger.ai(`Resultado da ferramenta "${call.function.name}": ${resultContent.slice(0, 250)}`);
            messages.push({role:'tool',tool_call_id:call.id,content:resultContent});
        }
        if (ctx.toolReplySent) return '';
    }
    if (hasExecutedTools) return '';
    throw new Error('Limite de ações atingido. Faça um pedido mais específico.');
}

module.exports = { stripThinking, parsePythonKwargs, extractPseudoToolCalls, completion, generateResponse, executeAgentLoop };
