const config = require('../config');
const {Queue} = require('./queue');
const {chatJid} = require('./jid');
const {createToolExecutor} = require('./tools');
const {logger} = require('../utils/logger');
const TOOL_REACTIONS = {search_web:'🔎',check_steam:'🎮',search_game:'🧲',download_game_torrent:'📦',convert_currency:'💱',generate_image:'🎨',create_sticker:'✂️',sticker_to_image:'🖼️',download_video:'🎬',download_audio:'🎵',search_and_download_music:'🎵',send_voice_note:'🎙️',anime_source:'🔍'};
function getHelpText() {
    const p = config.prefix || '>';
    return `*╭───「 HIKARI ZAP 」───*
*│* Atendimento privado e em grupos
*╰──────────────────────*

*💬 COMO CONVERSAR*
• *No Privado:* Converse normalmente em linguagem comum.
• *Em Grupos:* Mencione @Hikari, responda a uma mensagem minha ou me chame pelo nome.

*🗣️ É SÓ PEDIR, SEM COMANDO*
• "Hikari, pesquisa sobre esse assunto" ou "quanto custa Portal 2 na Steam?"
• "Converte 10 dólares para reais"
• "Faz essa figurinha aqui" — envie ou cite uma imagem, GIF ou vídeo
• "Cria uma imagem de um gato astronauta"
• "Baixa esse vídeo: <link>" ou "baixa a música <nome e artista>"
• "Busca o torrent de <jogo>" — depois escolha um resultado
• "Lê esse texto em voz alta" ou "responde em áudio"

*🔍 BUSCA & UTILITÁRIOS*
• \`${p}pesquisa <assunto>\` — Busca notícias e fatos na internet
• \`${p}steam <jogo>\` — Preço e detalhes de jogos na Steam
• \`${p}moeda <valor> <de> <para>\` — Conversão de moedas (ex: \`${p}moeda 10 USD BRL\`)
• \`${p}anime\` — Identifica anime por imagem anexada ou citada

*🎬 MÍDIA & DOWNLOADS*
• \`${p}view\` — Reenvia mensagem, imagem, vídeo, áudio ou sticker citado
• \`${p}musica <nome e artista>\` — Baixa faixas pelo Deezer em áudio nativo
• \`${p}baixar_video <link>\` — Baixa vídeos (Instagram, TikTok, YouTube, X)
• \`${p}baixar_audio <link>\` — Extrai áudio de vídeos da internet
• \`${p}buscar_jogo <nome>\` — Lista até 5 torrents de jogos
• \`${p}torrent <número>\` — Envia o arquivo do resultado escolhido
• \`${p}imagem <descrição>\` — Gera imagens por inteligência artificial
• \`${p}sticker [descrição]\` — Imagem, GIF ou vídeo em figurinha (até 10 s; descrição até 128 caracteres)
• \`${p}sticker2image\` — Figurinha estática em PNG; animada em arquivo GIF completo

*🎙️ VOZ & TRANSCRIÇÃO*
• \`${p}falar <texto>\` — Síntese de fala literal
• \`${p}transcrever\` — Transcreve um áudio anexado ou citado
• \`${p}audio <pergunta>\` — Resposta gerada pela IA em voz

*⚙️ CONTROLE DO CHAT*
• \`${p}telemetria\` — Seus dados de sessão, latência e estado do bot
• \`${p}ping\` — Tempo de processamento da resposta
• \`${p}userinfo\` — Seus dados e os da conversa
• \`${p}cancelar\` — Interrompe qualquer operação em andamento
• \`${p}limpar\` — Apaga o contexto de mensagens da conversa
• \`${p}ajuda\` — Exibe este menu

*👑 DONO*
• \`${p}pausar\` | \`${p}retomar\` | \`${p}fila\`

────────────────────────
_Dica: Você não precisa usar comandos para tudo! Pode falar naturalmente: "Hikari, pesquise as notícias de hoje" ou "baixa esse vídeo"._`;
}
const HELP = getHelpText();
const TERMS = 'Hikari Zap ativa para amigos e grupos autorizados.';
function command(text) {
    const p = config.prefix || '>';
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(text || '').trim().match(new RegExp(`^(?:${escaped}|/)(\\S+)(?:\\s+([\\s\\S]*))?$`));
    return match ? {name:match[1].toLowerCase(),args:(match[2] || '').trim()} : {name:'',args:''};
}
function format(value) {
    if (typeof value === 'string') return value;
    if (value?.error) return value.error;
    if (Array.isArray(value)) return value.length ? value.map(x => {
        if (x.snippet !== undefined) return `${x.title}\n${x.snippet}\n${x.url}`;
        return `${x.title} — episódio ${x.episode ?? '?'}\nSemelhança: ${x.similarity}% · tempo: ${x.seconds}s\n${x.url}`;
    }).join('\n\n') : 'Nenhum resultado encontrado.';
    if (value?.price) return `${value.name}\n${value.description}\nPreço: ${value.price}${value.discount ? ` (-${value.discount}%)` : ''}\nLançamento: ${value.releaseDate}\n${value.url}`;
    if (value?.rate !== undefined) return `${value.amount} ${value.from} = ${value.result} ${value.to}\nCotação: ${value.rate}\nAtualização: ${value.lastUpdate || 'Não informada'}${value.source ? `\nFonte: ${value.source}` : ''}${value.frequency ? `\n${value.frequency}` : ''}${value.calculation ? `\n${value.calculation}` : ''}`;
    if (value?.content !== undefined) return `${value.key}: ${value.content}`;
    return value?.message || (value?.ok ? 'Pronto.' : JSON.stringify(value));
}
function formatDuration(totalSeconds) {
    const seconds = Math.max(0,Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}min`);
    parts.push(`${seconds % 60}s`);
    return parts.join(' ');
}
function getTelemetryText(message, queue, isOwner, now = Date.now()) {
    const receivedAt = Number(message.receivedAt);
    const latency = Number.isFinite(receivedAt) && receivedAt > 0 ? Math.max(0,now - receivedAt) : 0;
    const memory = process.memoryUsage();
    const phone = String(message.senderId || '').split('@')[0] || 'Não identificado';
    const jidType = String(message.senderId || '').endsWith('@lid') ? 'LID' : 'Telefone';
    return `*TELEMETRIA HIKARI*

*Usuário*
• Nome: ${String(message.senderName || 'Participante').slice(0,80)}
• Número: ${jidType === 'Telefone' ? `+${phone}` : 'Não disponível (LID)'}
• Identificador: ${message.senderId}
• Tipo do identificador: ${jidType}
• Proprietário: ${isOwner ? 'sim' : 'não'}

*Conversa*
• Tipo: ${message.isGroup ? 'grupo' : 'privada'}
• ID do chat: ${message.chatId}
• ID da mensagem: ${message.id}
• Mídia: ${message.mediaType || 'nenhuma'}
• Resposta à Hikari: ${message.isReplyToBot ? 'sim' : 'não'}
• Menção à Hikari: ${message.isBotMentioned ? 'sim' : 'não'}

*Bot*
• Ping até esta resposta: ${latency} ms
• Fila: ${queue.activeCount ?? (queue.active ? 1 : 0)} ativa, ${queue.items.length} aguardando
• Pausada: ${queue.paused ? 'sim' : 'não'}
• Uptime: ${formatDuration(process.uptime())}
• Memória: ${Math.round(memory.rss / 1048576)} MB RSS / ${Math.round(memory.heapUsed / 1048576)} MB heap
• Runtime: Node.js ${process.version}
• Plataforma: ${process.platform} ${process.arch}
• Memória heap reservada: ${Math.round(memory.heapTotal / 1048576)} MB
• Memória externa: ${Math.round(memory.external / 1048576)} MB
• Fuso horário: America/Sao_Paulo
• Horário: ${new Date(now).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
}
function queueOptions() { return {concurrency:config.queueConcurrency,perChatLimit:config.maxQueuePerChat,maxWaitMs:config.queueWaitMs,taskTimeoutMs:config.queueTaskTimeout}; }
function createRouter({store, queue = new Queue(config.maxQueue,queueOptions()), executeTool = createToolExecutor(), agent, transcribe, describe, stickerService} = {}) {
    if (!store) throw new Error('Armazenamento obrigatório.');
    const ownerQueue = new Queue(config.maxQueue,{...queueOptions(),concurrency:1});
    const availabilityNotices = new Map();
    agent ||= (...args) => require('../handlers/llmHandler').executeAgentLoop(...args);
    transcribe ||= async (media, signal) => {
        const wav = await require('../services/mediaService').toWav(media.buffer,signal);
        signal?.throwIfAborted();
        const text = await require('../services/sttService').transcribeAudio(wav,'speech.wav',signal);
        signal?.throwIfAborted();
        if (typeof text !== 'string' || !text.trim()) throw new Error('Transcrição indisponível; configure um provedor STT.');
        return text;
    };
    describe ||= (media, signal) => require('../handlers/imageVisionHandler').describeImage(media.buffer,media.mimetype,signal);
    return {
        queue,
        async handle(message) {
            if (!message || message.fromMe || !chatJid(message.chatId) || !/^\d+@(s\.whatsapp\.net|lid)$/.test(message.senderId || '') || !message.id) return;
            const senderId = message.senderId;
            const sendReply = async (payload, options = {}) => {
                const notify = !message.isGroup && store.helpNotified && !store.helpNotified(senderId);
                const note = `Use ${config.prefix || '>'}ajuda para ver tudo que eu posso fazer.`;
                let output = payload;
                if (notify && typeof payload.text === 'string') output = {...payload,text:`${payload.text}\n\n${note}`};
                else if (notify && (payload.image || payload.video || payload.document)) output = {...payload,caption:payload.caption ? `${payload.caption}\n\n${note}` : note};
                const sent = await message.send(output, options);
                if (notify) {
                    if (output === payload) await message.send({text:note});
                    store.markHelpNotified(senderId);
                }
                return sent;
            };
            const isOwner = [senderId,...(message.senderAliases || [])].some(id=>config.isOwner(id));
            if (store.seen(`${message.chatId}:${message.id}`)) return;
            const cmd = command(message.text);
            const choiceText = String(message.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
            const choice = choiceText.match(/^(?:(?:eu\s+)?(?:quero|manda|mande|envia|envie|baixa|baixe|pega|pegue|escolho|seleciona|selecione)\s+)?(?:(?:o|a|numero|opcao|resultado|jogo)\s+)*(\d+|primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta)(?:\s+(?:por favor|pfv|pf|pra mim|para mim))?[.!]?$/);
            if (!cmd.name && message.quotedMessageId && message.isReplyToBot && choice) {
                cmd.name = 'torrent';
                cmd.args = String(({primeiro:1,primeira:1,segundo:2,segunda:2,terceiro:3,terceira:3,quarto:4,quarta:4,quinto:5,quinta:5})[choice[1]] || choice[1]);
            }
            const rawText = message.text || '';
            const isDotVoice = !cmd.name && /^\.(?!\.)\s*\S+/.test(rawText.trim());
            const wantsAudio = Boolean(isDotVoice || cmd.name === 'audio');
            const recordText = text => message.isGroup ? `${JSON.stringify(message.senderName || 'Participante')}: ${text}` : text;
            const stickerRequest = message.hasMedia && /\b(?:fa[zç]a?|cria?r?|transforma?r?|converte?r?)\b[\s\S]{0,100}\b(?:figurinha|sticker)\b/iu.test(message.text || '');
            const addressed = !message.isGroup || Boolean(cmd.name || stickerRequest || message.isBotMentioned || message.isReplyToBot || /\bhikari\b/iu.test(message.text || '') || (config.botName && (message.text || '').toLocaleLowerCase().includes(config.botName.toLocaleLowerCase())));
            if (!addressed) {
                logger.zap(`Mensagem em grupo ignorada (não direcionada à Hikari) de "${message.senderName}": "${(message.text || '').slice(0, 80)}"`);
                if (!queue.paused && message.text) store.addHistory(message.chatId,'user',recordText(message.text));
                return;
            }
            logger.zap(`Mensagem direcionada à Hikari de "${message.senderName}" no chat ${message.chatId}. Enfileirando...`);
            const sendText = text => sendReply({text:String(text)});
            if (['cancelar','parar'].includes(cmd.name)) {
                logger.command(`${config.prefix || '>'}${cmd.name} acionado por "${message.senderName}" no chat ${message.chatId}`);
                const main = queue.cancel(isOwner ? null : message.chatId);
                const owner = ownerQueue.cancel(isOwner ? null : message.chatId);
                const res = {aborted:main.aborted||owner.aborted,dropped:main.dropped+owner.dropped};
                if (res.aborted || res.dropped) return sendText('Operação cancelada com sucesso.');
                return sendText('Nenhuma operação em andamento para cancelar.');
            }
            if (isOwner && ['pausar','retomar','fila'].includes(cmd.name)) {
                if (cmd.name === 'pausar') { queue.pause(); return message.react?.('\u23f8\ufe0f'); }
                if (cmd.name === 'retomar') { queue.resume(); return message.react?.('\u25b6\ufe0f'); }
                if (cmd.name === 'fila') return sendText(`Ativa: ${queue.activeCount ?? (queue.active ? 1 : 0)}; aguardando: ${queue.items.length}; pausada: ${queue.paused}.`);
            }
            if (queue.paused && !isOwner) return sendText('A Hikari está pausada para manutenção.');
            if (['ajuda','help'].includes(cmd.name)) return sendText(getHelpText());
            if (['telemetria','diagnostico','ping','userinfo'].includes(cmd.name)) {
                const report = getTelemetryText(message,queue,isOwner);
                if (cmd.name === 'ping') return sendText(`*Bot*${report.split('*Bot*')[1]}\nTempo entre receber e preparar a resposta; não inclui entrega pelo WhatsApp.`);
                if (cmd.name === 'userinfo') return sendText(`*USERINFO HIKARI*\n${report.split('*Usuário*')[1].split('*Bot*')[0].trim()}`);
                return sendText(report);
            }
            if ((message.text || '').length > 8000) return sendText('Envie até 8000 caracteres por mensagem.');
            if (!message.text && !message.hasMedia) return;
            try {
                return await (isOwner && queue.paused ? ownerQueue : queue).enqueue(message.chatId,async signal => {
                    let reacted = '';
                    const markReact = async name => {
                        const emoji = TOOL_REACTIONS[name] || '⏳';
                        if (reacted !== emoji && message.react) {
                            reacted = emoji;
                            await message.react(emoji);
                        }
                    };
                    try {
                        const ctx = {...message,store,isOwner,signal,senderId,wantsAudio,mediaSent:false,audioSent:false,onToolStart:markReact,history:store.history(message.chatId).slice(-(config.maxHistory-1)).map(x => ({...x})),send:async (payload, options = {}) => {
                            signal.throwIfAborted();
                            if (payload.audio) ctx.audioSent = true;
                            if (payload.audio || payload.image || payload.video || payload.document || payload.sticker) ctx.mediaSent = true;
                            const sent = await sendReply(payload, options);
                            const summary = payload.text || payload.caption;
                            if (summary) store.addHistory(message.chatId,'assistant',summary);
                            return sent;
                        }};
                        signal.throwIfAborted();
                        const tool = (name,args) => executeTool(name,args,ctx);
                        if (['limpar','hdel'].includes(cmd.name)) {
                            if (message.isGroup && !isOwner) return message.react?.('\ud83d\udd12');
                            store.clearHistory(message.chatId);
                            return message.react?.('\ud83e\uddf9');
                        }
                        store.addHistory(message.chatId,'user',recordText(message.text || '[Anexo recebido]'));
                        if (cmd.name) logger.command(`Executando comando "${config.prefix || '>'}${cmd.name}" de "${message.senderName}" | args: "${cmd.args}"`);
                        let result;
                        switch (cmd.name) {
                            case 'view': case 'ver': {
                                await markReact();
                                if (!message.hasMedia && !message.quotedText) {
                                    throw new Error('Cite uma mensagem, imagem, vídeo, áudio ou figurinha para visualizar.');
                                }
                                const wantsDm = Boolean(message.isGroup && /\b(?:<dm>|dm|--dm|-dm)\b/i.test(cmd.args));
                                const targetJid = wantsDm ? message.senderId : undefined;
                                const sendPayload = wantsDm ? {targetJid} : {};
                                if (message.hasMedia) {
                                    const media = await message.getMedia();
                                    if (!media?.buffer) throw new Error('Não foi possível obter a mídia solicitada.');
                                    if (media.type === 'image') {
                                        sendPayload.image = media.buffer;
                                        sendPayload.mimetype = media.mimetype || 'image/jpeg';
                                        if (message.quotedText) sendPayload.caption = String(message.quotedText).slice(0, 1000);
                                    } else if (media.type === 'video') {
                                        sendPayload.video = media.buffer;
                                        sendPayload.mimetype = media.mimetype || 'video/mp4';
                                        if (message.quotedText) sendPayload.caption = String(message.quotedText).slice(0, 1000);
                                    } else if (media.type === 'audio') {
                                        sendPayload.audio = media.buffer;
                                        sendPayload.mimetype = media.mimetype || 'audio/ogg; codecs=opus';
                                        sendPayload.ptt = true;
                                    } else if (media.type === 'sticker') {
                                        sendPayload.sticker = media.buffer;
                                    } else {
                                        throw new Error('Tipo de mídia não suportado para visualização.');
                                    }
                                } else {
                                    sendPayload.text = String(message.quotedText).slice(0, 24000);
                                }
                                await ctx.send(sendPayload, wantsDm ? {targetJid} : {});
                                ctx.mediaSent = true;
                                if (wantsDm && message.delete) {
                                    await message.delete().catch(() => {});
                                }
                                result = '';
                                break;
                            }
                            case 'buscar_jogo': case 'jogo': result = await tool('search_game',{game_name:cmd.args}); break;
                            case 'torrent': {
                                if (/^\d+$/.test(cmd.args)) result = await tool('download_game_torrent',{result_index:Number(cmd.args)});
                                else result = await tool('search_game',{game_name:cmd.args});
                                break;
                            }
                            case 'sticker': case 'figurinha': {
                                await markReact('create_sticker');
                                const media = await message.getMedia();
                                const service = stickerService || require('../services/stickerService');
                                const sticker = await service.toSticker(media,signal,cmd.args);
                                await ctx.send({sticker});
                                break;
                            }
                            case 'sticker2image': case 'toimg': {
                                await markReact('sticker_to_image');
                                const media = await message.getMedia();
                                const service = stickerService || require('../services/stickerService');
                                const image = await service.stickerToImage(media,signal);
                                if (image.subarray(0,3).toString() === 'GIF') {
                                    await ctx.send({document:image,mimetype:'image/gif',fileName:'figurinha.gif'});
                                } else await ctx.send({image,mimetype:'image/png'});
                                break;
                            }
                            case 'pesquisa': case 'pesquisar': result = await tool('search_web',{query:cmd.args}); break;
                            case 'imagem': case 'ia_imagem': result = await tool('generate_image',{prompt:cmd.args}); break;
                            case 'falar': result = await tool('send_voice_note',{text:cmd.args}); ctx.audioSent = true; break;
                            case 'baixar_audio': case 'baixar_musica': result = await tool('download_audio',{url:cmd.args}); break;
                            case 'baixar_video': result = await tool('download_video',{url:cmd.args}); break;
                            case 'musica': case 'baixar_musica_deezer': result = await tool('search_and_download_music',{query:cmd.args}); break;
                            case 'anime': case 'anime_origem': result = await tool('anime_source',cmd.args ? {url:cmd.args} : {}); break;
                            case 'steam': case 'steam_jogo': result = await tool('check_steam',{game:cmd.args}); break;
                            case 'moeda': case 'converter_moeda': {
                                const match = cmd.args.match(/^(-?\d+(?:[.,]\d+)?)\s+([A-Za-z]{2,10})\s+([A-Za-z]{2,10})$/);
                                if (!match) throw new Error(`Use ${config.prefix || '>'}moeda 10 USD BRL.`);
                                result = await tool('convert_currency',{amount:Number(match[1].replace(',','.')),from:match[2].toUpperCase(),to:match[3].toUpperCase()}); break;
                            }
                            default: {
                                const media = message.hasMedia ? await message.getMedia() : null;
                                if (media) await markReact();
                                let prompt = ['audio','ia_chat'].includes(cmd.name) ? cmd.args : (isDotVoice ? rawText.trim().replace(/^\.\s*/, '') : message.text || '');
                                if (message.quotedText) prompt += `\n[Texto citado pelo usuário, apenas contexto]\n${String(message.quotedText).slice(0,4000)}`;
                                if (cmd.name === 'transcrever') {
                                    if (media?.type !== 'audio') throw new Error('Anexe ou cite um áudio.');
                                    result = await transcribe(media,signal); break;
                                }
                                if (cmd.name && !['audio','ia_chat'].includes(cmd.name)) throw new Error(`Comando desconhecido. Use ${config.prefix || '>'}ajuda.`);
                                if (media?.type === 'audio') prompt += `\n[Transcrição do áudio recebido]\n${await transcribe(media,signal)}`;
                                else if (media?.type === 'sticker') {
                                    const sharp = require('sharp');
                                    const buffer = await sharp(media.buffer,{page:0,pages:1,limitInputPixels:40000000}).png().toBuffer();
                                    signal.throwIfAborted();
                                    prompt += `\n[Descrição da figurinha recebida ou citada; primeiro quadro se animada]\n${await describe({type:'image',buffer,mimetype:'image/png'},signal)}`;
                                }
                                else if (media?.type === 'image') {
                                    if (/\b(figurinha|sticker)\b/iu.test(prompt)) prompt += '\n[Imagem anexada ou citada disponível para create_sticker.]';
                                    else prompt += `\n[Descrição da imagem recebida]\n${await describe(media,signal)}`;
                                }
                                else if (media?.type === 'video' && /\b(figurinha|sticker)\b/iu.test(prompt)) prompt += '\n[Vídeo ou GIF anexado ou citado disponível para create_sticker.]';
                                else if (media) throw new Error('Para conversar, envie texto, imagem ou áudio.');
                                if (!prompt.trim()) throw new Error('Envie uma pergunta ou um anexo.');
                                signal.throwIfAborted();
                                const currentPrompt = message.isGroup ? `[Pedido atual de ${JSON.stringify(message.senderName || 'Participante')}]\n${prompt}` : prompt;
                                logger.ai(`Disparando agente para "${message.senderName}" no chat ${message.chatId} | Prompt: "${prompt.slice(0, 100)}"`);
                                result = await agent(currentPrompt,ctx,executeTool);
                                if (isDotVoice || cmd.name === 'audio') {
                                    if (typeof result === 'string' && result.trim() && !ctx.mediaSent) {
                                        try {
                                            await tool('send_voice_note',{text:result.slice(0,config.voiceMaxChars)});
                                            ctx.audioSent = true;
                                        } catch (err) {
                                            logger.warn(`Falha na síntese de voz: ${err.message}; enviando como texto.`);
                                            await ctx.send({text:format(result)});
                                            ctx.audioSent = true;
                                        }
                                    }
                                }
                            }
                        }
                        signal.throwIfAborted();
                        if (result !== undefined && !ctx.audioSent && !ctx.mediaSent && !ctx.toolReplySent) {
                            const text = format(result);
                            if (text && text !== 'Pronto.' && text !== 'Arquivo enviado.' && text !== 'Imagem enviada.' && text !== 'Mensagem de voz enviada.') {
                                await ctx.send({text});
                            }
                        }
                    } finally {
                        if (reacted && message.react) await message.react('').catch(() => {});
                    }
                });
            } catch (error) {
                if(error.code==='QUEUE_CANCELLED')return;
                logger.error('Pedido falhou: '+error.message, error);
                if(message.react) await message.react('\u274c').catch(err=>logger.warn('Falha ao reagir: '+err.message));

            }
        }
    };
}
module.exports = { createRouter, command, format, HELP, TERMS, getHelpText, getTelemetryText };
