const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const schemas = require('../data/mcp_tools.json');
const {logger} = require('../utils/logger');

function validate(name, args) {
    const schema = schemas.find(x => x.function.name === name)?.function.parameters;
    if (!schema) throw new Error('Ferramenta indisponível.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos.');
    for (const key of schema.required || []) if (args[key] === undefined || typeof args[key] === 'string' && !args[key].trim()) throw new Error(`Falta o argumento ${key}.`);
    for (const [key,value] of Object.entries(args)) {
        const rule = schema.properties[key];
        if (!rule) throw new Error(`Argumento não permitido: ${key}.`);
        if (rule.type === 'string' && (typeof value !== 'string' || value.length > 4000)) throw new Error(`Texto inválido: ${key}.`);
        if (['number','integer'].includes(rule.type) && (typeof value !== 'number' || !Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value)))) throw new Error(`Número inválido: ${key}.`);
        if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Valor inválido: ${key}.`);
        if (rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum) throw new Error(`Valor fora do limite: ${key}.`);
    }
}

function createToolExecutor(overrides = {}) {
    const service = {
        search: (...a) => require('../handlers/searchManager').searchWeb(...a),
        steam: (...a) => require('../handlers/steamHandler').getSteamGameInfo(...a),
        currency: (...a) => require('../handlers/currencyHandler').convertCurrency(...a),
        searchGames: (...a) => require('../services/torrentService').searchGames(...a),
        torrentFile: (...a) => require('../services/torrentService').getTorrentOrMagnet(...a),
        image: (...a) => require('../handlers/imageHandler').generateImage(...a),
        sticker: (...a) => require('../services/stickerService').toSticker(...a),
        voice: (...a) => require('../services/ttsService').synthesizeVoiceAudio(...a),
        download: (...a) => require('../services/mediaService').download(...a),
        anime: (...a) => require('../handlers/sauceHandler').getAnimeSource(...a),
        ...overrides
    };
    const torrentSelections = new Map();
    let selectionSequence = 0;
    return async function execute(name, args, ctx) {
        ctx.signal?.throwIfAborted();
        if (ctx.onToolStart) await ctx.onToolStart(name);
        logger.tool(`Iniciando execução da ferramenta "${name}" | args: ${JSON.stringify(args)}`);
        validate(name,args);
        if (name === 'create_sticker') {
            const media = await ctx.getMedia();
            const sticker = await service.sticker(media,ctx.signal,args.description || '');
            ctx.signal?.throwIfAborted();
            await ctx.send({sticker});
            ctx.mediaSent=true;
            return {ok:true,message:'Figurinha enviada.'};
        }
        const selectionKey = JSON.stringify([ctx.chatId,ctx.senderId]);
        if (name === 'search_game') {
            const games = await service.searchGames(args.game_name,ctx.signal);
            ctx.signal?.throwIfAborted();
            for (const [key,value] of torrentSelections) if(Date.now()-value.at>600000)torrentSelections.delete(key);
            if(!games.length)return {error:'Nenhum torrent encontrado no catálogo local. Tente o nome completo do jogo.'};
            if(torrentSelections.size>=100)torrentSelections.delete(torrentSelections.keys().next().value);
            const items=games.slice(0,5);
            const line = value => String(value).replace(/[\r\n\t]/g,' ').slice(0,130);
            const sent = await ctx.send({text:items.map((game,i)=>`${i+1}. ${line(game.title)} — ${line(game.provider)}${game.fileSize ? ` · ${line(game.fileSize)}` : ''}`).join('\n')+`\n\nResponda esta lista com um número ou use ${config.prefix || '>'}torrent 1–${items.length}. Sem resposta direta, vale sua última busca nesta conversa. Validade: 10 minutos.`});
            torrentSelections.set(++selectionSequence,{scope:selectionKey,messageId:sent?.key?.id,at:Date.now(),items});
            ctx.toolReplySent=true;
            return {ok:true,message:'Resultados enviados; aguarde a escolha do usuário.'};
        }
        if (name === 'download_game_torrent') {
            const selection=[...torrentSelections.values()].reverse().find(value=>value.scope===selectionKey && (!ctx.quotedMessageId || value.messageId===ctx.quotedMessageId));
            if(!selection || Date.now()-selection.at>600000) {
                throw new Error(`Faça uma busca com ${config.prefix || '>'}torrent nome; a seleção expirou ou não existe para você nesta conversa. Se respondeu uma mensagem, responda à lista correta.`);
            }
            const game=selection.items[args.result_index-1];
            if(!game)throw new Error(`Escolha um número de 1 a ${selection.items.length}.`);
            const result=await service.torrentFile(game,ctx.signal);
            ctx.signal?.throwIfAborted();
            if(result.buffer.length>config.maxMediaBytes)throw new Error('Arquivo acima do limite de envio.');
            await ctx.send({document:result.buffer,fileName:result.fileName,mimetype:result.mimetype,
                caption:`${String(game.title).replace(/[\r\n]/g,' ').slice(0,140)} · ${game.provider}${result.fallback ? '\n.torrent indisponível; magnet no arquivo de texto.' : ''}`});
            ctx.mediaSent=true;
            return {ok:true,message:'Arquivo enviado.'};
        }
        const capability={download_audio:'download',download_video:'download',send_voice_note:'voice',search_and_download_music:'deezer'}[name];
        if(capability&&config.capabilities?.[capability]===false)throw new Error('Esta função não está configurada. Confira os avisos de inicialização no terminal ou nos logs.');
        if (name === 'search_web') return service.search(args.query,ctx.signal);
        if (name === 'check_steam') return service.steam(args.game);
        if (name === 'convert_currency') return service.currency(args.amount,args.from,args.to || 'BRL',ctx.signal);
        if (name === 'generate_image') {
            const result = await service.image(args.prompt,args.negative_prompt || '',args.width || 1024,args.height || 1024);
            if (!result) throw new Error('Não foi possível gerar a imagem.');
            try {
                ctx.signal?.throwIfAborted();
                const buffer = result.localFilePath ? fs.readFileSync(result.localFilePath) : Buffer.from((await require('../utils/network').safeGet(result.imageUrl,{responseType:'arraybuffer',signal:ctx.signal})).data);
                const caption = (ctx.mediaCaption && !/\b(gerando|aguard|criando)\b/i.test(ctx.mediaCaption)) ? ctx.mediaCaption : (args.prompt || 'Imagem gerada pela Hikari.');
                await ctx.send({image:buffer,caption});
                ctx.mediaSent = true;
            } finally { if (result.localFilePath) fs.rmSync(result.localFilePath,{force:true}); }
            return {ok:true,message:'Imagem enviada.'};
        }
        if (name === 'send_voice_note') {
            if (!args.text.trim() || args.text.length > config.voiceMaxChars) throw new Error(`Use de 1 a ${config.voiceMaxChars} caracteres por áudio.`);
            const result = await service.voice(args.text);
            ctx.signal?.throwIfAborted();
            if (!result?.oggBuffer) throw new Error('TTS indisponível; confira os endpoints de voz.');
            await ctx.send({audio:result.oggBuffer,mimetype:'audio/ogg; codecs=opus',ptt:true});
            ctx.audioSent = true;
            ctx.mediaSent = true;
            return {ok:true,message:'Mensagem de voz enviada.'};
        }
        if (['download_audio','download_video'].includes(name)) {
            const type = name === 'download_audio' ? 'audio' : 'video';
            const result = await service.download(args.url,type,ctx.signal);
            try {
                ctx.signal?.throwIfAborted();
                if (fs.statSync(result.filePath).size > config.maxMediaBytes) throw new Error('Arquivo acima do limite.');
                if (type === 'audio') {
                    await ctx.send({audio:fs.readFileSync(result.filePath),mimetype:'audio/mpeg',ptt:false});
                    ctx.audioSent = true;
                } else {
                    const rawTitle = (result.fileName || path.basename(result.filePath)).replace(/\.mp4$/i,'').replace(/_/g,' ').trim();
                    const caption = (ctx.mediaCaption && !/\b(baixando|rapidinho|aguard|esper)\b/i.test(ctx.mediaCaption)) ? ctx.mediaCaption : (rawTitle && rawTitle !== 'media' ? rawTitle : '');
                    await ctx.send({video:fs.readFileSync(result.filePath),mimetype:'video/mp4',...(caption ? {caption} : {})});
                }
                ctx.mediaSent = true;
            } finally { result.cleanup(); }
            return {ok:true,message:'Arquivo enviado.'};
        }
        if (name === 'search_and_download_music') {
            const deezer = require('../services/deezerMusicService');
            const tracks = await deezer.searchDeezerTracks(args.query,ctx.signal);
            if (!tracks.length) return {error:'Música não encontrada.'};
            const file = await deezer.downloadDeezerTrack(tracks[0].link,ctx.signal);
            try {
                ctx.signal?.throwIfAborted();
                if (fs.statSync(file).size > config.maxMediaBytes) throw new Error('Música acima do limite.');
                await ctx.send({audio:fs.readFileSync(file),mimetype:'audio/mpeg',ptt:false});
                ctx.audioSent = true;
                ctx.mediaSent = true;
            } finally { deezer.cleanupTempAudio(file); }
            return {ok:true,title:tracks[0].title,artist:tracks[0].artist};
        }
        if (name === 'anime_source') {
            let media;
            if (args.url) {
                const response = await require('../utils/network').safeGet(args.url,{responseType:'arraybuffer',signal:ctx.signal,maxContentLength:10*1024*1024});
                media = {buffer:Buffer.from(response.data),mimetype:response.headers['content-type']?.split(';')[0] || 'image/jpeg'};
            } else media = await ctx.getMedia();
            if (!media || media.type && media.type !== 'image' || !media.mimetype.startsWith('image/')) throw new Error('Anexe ou cite uma imagem com !anime.');
            return service.anime(media.buffer,media.mimetype,ctx.signal);
        }
        throw new Error('Ferramenta indisponível.');
    };
}

module.exports = { createToolExecutor, validate };
