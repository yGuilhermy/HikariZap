const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const {Store} = require('./store');
const {createRouter} = require('./router');
const {logger} = require('../utils/logger');
const {acquireSessionLock,createSendLimiter} = require('./runtime');

const {userJid,chatJid,isPhoneJid,IdentityMap} = require('./jid');
function normalizeIncoming(raw, normalizeMessageContent, {botJids = [], sentMessageKeys, identities} = {}) {
    const jid = raw.key?.remoteJid;
    if (!chatJid(jid) || raw.key.fromMe || !raw.message) return null;
    const isGroup = jid.endsWith('@g.us');
    const content = normalizeMessageContent(raw.message) || {};
    if (content.protocolMessage || content.reactionMessage) return null;
    const textNode = content.extendedTextMessage || content.imageMessage || content.videoMessage || content.audioMessage || content.stickerMessage || {};
    const context = textNode.contextInfo || {};
    const quoted = context.quotedMessage;
    const currentType = ['image','audio','video','sticker'].find(t => content[`${t}Message`]);
    const quotedContent = quoted ? normalizeMessageContent(quoted) || {} : {};
    const mediaContent = currentType ? content : quotedContent;
    const mediaType = currentType || ['image','audio','video','sticker'].find(t => mediaContent[`${t}Message`]);
    identities?.learnMessageKey(raw.key,isGroup);
    const candidates=(isGroup?[raw.key.participantPn,raw.key.participantAlt,raw.key.senderPn]:[raw.key.senderPn,raw.key.remoteJidAlt]).map(userJid).filter(Boolean);
    const primary=userJid(isGroup?raw.key.participant:jid);
    const senderId=identities?.resolve(primary)||primary;
    const canonicalSender=isPhoneJid(senderId)?senderId:candidates.find(isPhoneJid)||senderId;
    if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(canonicalSender)) return null;
    const senderAliases=[...new Set([primary,canonicalSender,...(identities?.aliases(canonicalSender)||[])].filter(Boolean))];
    const bots=new Set(botJids.map(userJid).filter(Boolean));
    const isBot=id=>[...bots].some(bot=>identities?identities.same(id,bot):userJid(id)===bot);
    return {id:raw.key.id,key:raw.key,chatId:isGroup ? jid : canonicalSender,senderId:canonicalSender,senderAliases,transportJid:jid,fromMe:false,isGroup,receivedAt:Date.now(),
        senderName:String(raw.pushName || 'Participante').replace(/[\r\n]/g,' ').slice(0,80),
        isBotMentioned:(textNode.contextInfo?.mentionedJid || []).some(isBot),
        isReplyToBot:Boolean(quoted && (
            [context.participant,context.participantAlt].some(id => id && isBot(id)) ||
            (context.stanzaId && sentMessageKeys?.has(`${jid}:${context.stanzaId}`))
        )),
        text:content.conversation || textNode.text || textNode.caption || '',
        hasMedia:Boolean(mediaType),mediaType,mediaNode:mediaContent[`${mediaType}Message`],
        quotedMessageId:quoted ? context.stanzaId : undefined,
        quotedText:quotedContent.conversation || quotedContent.extendedTextMessage?.text || ''};
}
async function start({store = new Store()} = {}) {
    const wa = await import('baileys');
    const pino = require('pino');
    const qrcode = require('qrcode-terminal');
    fs.mkdirSync(config.authDir,{recursive:true,mode:0o700});
    fs.chmodSync(config.authDir,0o700);
    let releaseLock;
    try { releaseLock = acquireSessionLock(config.authDir); }
    catch (error) {
        logger.warn('Não foi possível reservar a sessão. Confira se outra instância da Hikari está aberta ou se a trava de sessão precisa de revisão.');
        throw error;
    }
    process.once('exit',releaseLock);
    const {state,saveCreds} = await wa.useMultiFileAuthState(config.authDir);
    logger.system(state.creds.registered ? 'Sessão salva encontrada; validando login no WhatsApp.' : 'Sem login salvo; aguardando QR code para pareamento.');
    if (config.notifyOwnerOnConnect && !config.ownerNumbers.length) logger.warn('Configure WHATSAPP_OWNER_NUMBERS para receber a confirmação de conexão.');
    const router = createRouter({store});
    const identities = new IdentityMap(path.join(config.dataDir,'identities.json'));
    process.once('exit',()=>identities.flush());
    const sentMessageKeys = new Set();
    let socket, timer, stableTimer, stopping = false, attempts = 0, qrCount = 0;
    let saveChain = Promise.resolve();
    function halt(reason) {
        if (stopping) return;
        stopping = true;
        clearTimeout(timer);
        clearTimeout(stableTimer);
        router.queue.pause();
        logger.warn(reason);
        const closing = socket;
        socket = null;
        closing?.end(new Error('Conexão interrompida por proteção local.'));
    }
    const retryDelay = () => Math.min(120000,10000*2**attempts);
    const sendLimited = createSendLimiter({
        send:(current,jid,payload,options) => current.sendMessage(jid,payload,options),
        isActive:current => !stopping && socket === current,
        onRestricted:code => halt(`Envio recusado pelo WhatsApp (${code}); novos envios e reconexões interrompidos. Confira a conta no aplicativo oficial.`),
        onLimit:() => logger.warn('Limite local de envios atingido; resposta suprimida para evitar rajada.')
    });
    const notifiedOwners = new Set();
    const notifyingOwners = new Set();
    async function notifyOwners(currentSocket) {
        if (!config.notifyOwnerOnConnect) return;
        for (const phone of new Set(config.ownerNumbers)) {
            if (stopping || socket !== currentSocket) return;
            if (notifiedOwners.has(phone) || notifyingOwners.has(phone)) continue;
            notifyingOwners.add(phone);
            try {
                await sendLimited(currentSocket,`${phone}@s.whatsapp.net`,{text:'Hikari Zap conectada ao WhatsApp e pronta para receber mensagens. Login confirmado; conversas privadas e grupos disponíveis.'});
                notifiedOwners.add(phone);
                logger.system('Confirmação de conexão enviada ao proprietário.');
            } catch {
                logger.warn('Não foi possível enviar a confirmação ao proprietário. Confira o número configurado; o bot continuará funcionando.');
            } finally {
                notifyingOwners.delete(phone);
            }
        }
    }
    function reconnect(delay) {
        if (stopping) return;
        if (attempts >= 5) {
            halt('Limite de cinco reconexões atingido; sessão preservada. Confira a conta antes de iniciar novamente.');
            return;
        }
        attempts++;
        clearTimeout(timer);
        logger.info(`Reconexão ${attempts}/5 agendada em ${Math.ceil(delay/1000)} segundos.`);
        timer = setTimeout(() => connect().catch(() => {
            logger.error('Falha ao reconectar usando a sessão salva.');
            if (!stopping) reconnect(retryDelay());
        }),delay);
    }
    async function connect() {
        if (stopping) return;
        await saveChain;
        if (stopping) return;
        socket = wa.default({auth:state,logger:pino({level:'silent'}),markOnlineOnConnect:false,syncFullHistory:false,
            shouldSyncHistoryMessage:() => false});
        const currentSocket = socket;
        const learnContacts = contacts => {
            if(stopping||socket!==currentSocket)return;
            for(const contact of contacts||[])identities.learnContact(contact);
        };
        currentSocket.ev.on('contacts.upsert',learnContacts);
        currentSocket.ev.on('contacts.update',learnContacts);
        currentSocket.ev.on('chats.phoneNumberShare',pair => {
            if(!stopping&&socket===currentSocket)identities.learn([pair.lid,pair.jid]);
        });
        currentSocket.ev.on('groups.upsert',groups => {
            if(!stopping&&socket===currentSocket)for(const group of groups||[])learnContacts(group.participants);
        });
        currentSocket.ev.on('creds.update',() => {
            if (stopping || socket !== currentSocket) return;
            const persist = saveCreds;
            saveChain = saveChain.then(persist).catch(() => logger.error('Falha ao salvar sessão WhatsApp.'));
        });
        currentSocket.ev.on('connection.update',update => {
            if (stopping || socket !== currentSocket) return;
            if (update.qr) {
                if (++qrCount > 2) {
                    halt('Prazo de pareamento encerrado. Nenhuma nova tentativa automática será feita; confira se a conta permite adicionar dispositivos.');
                    return;
                }
                console.log('Abra WhatsApp > Aparelhos conectados > Conectar aparelho e escaneie o QR no terminal.');
                qrcode.generate(update.qr,{small:true});
            }
            if (update.connection === 'open') {
                identities.learn([socket.user?.id,socket.user?.lid,state.creds.me?.id,state.creds.me?.lid]);
                clearTimeout(stableTimer);
                stableTimer = setTimeout(() => { attempts = 0; },120000);
                logger.system('Login confirmado. Hikari Zap conectada; chats privados e grupos.');
                notifyOwners(currentSocket).catch(() => logger.warn('Falha na confirmação ao proprietário.'));
            }
            if (update.connection === 'close') {
                const persist = saveCreds;
                saveChain = saveChain.then(persist).catch(() => logger.error('Falha ao salvar sessão WhatsApp.'));
                socket = null;
                clearTimeout(timer);
                clearTimeout(stableTimer);
                const error = update.lastDisconnect?.error;
                const code = Number(error?.output?.statusCode) || undefined;
                const reasonNode = Array.isArray(error?.data?.content) ? error.data.content.find(node => node?.tag) : null;
                const reason = String(reasonNode?.tag || error?.data?.reason || error?.data?.attrs?.reason || 'nao-informado').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
                logger.warn(`Conexão WhatsApp fechada: código ${code || 'desconhecido'}; motivo ${reason}.`);
                if ([wa.DisconnectReason.loggedOut,wa.DisconnectReason.connectionReplaced,wa.DisconnectReason.forbidden,wa.DisconnectReason.multideviceMismatch,405,406,429].includes(code)) {
                    halt('Login encerrado, conexão recusada ou restrita. Sessão preservada; não será solicitado outro QR automaticamente. Confira a conta no aplicativo oficial antes de reiniciar.');
                    return;
                }
                logger.info(code === wa.DisconnectReason.restartRequired ? 'Finalizando pareamento; reconectando com a sessão salva.' : 'Reconectando sem descartar o login salvo.');
                reconnect(code === wa.DisconnectReason.restartRequired ? 1000 : retryDelay());
            }
        });
        currentSocket.ev.on('messages.upsert',event => {
            if (stopping || socket !== currentSocket || event.type !== 'notify') return;
            for (const raw of event.messages) {
                const normalized = normalizeIncoming(raw,wa.normalizeMessageContent,{botJids:[socket.user?.id,socket.user?.lid,state.creds.me?.id,state.creds.me?.lid],sentMessageKeys,identities});
                if (!normalized) continue;
                logger.zap(`Mensagem recebida de "${normalized.senderName}" (${normalized.senderId}) no chat ${normalized.chatId} [${normalized.isGroup ? 'GRUPO' : 'PRIVADO'}] | Texto: "${normalized.text.slice(0, 150)}"${normalized.hasMedia ? ` | Anexo: ${normalized.mediaType}` : ''}`);
                let mediaPromise;
                normalized.getMedia = () => mediaPromise ||= (async () => {
                    const node = normalized.mediaNode;
                    if (!node) return null;
                    if (Number(node.fileLength || 0) > config.maxMediaBytes) throw new Error('Anexo acima do limite de mídia.');
                    const stream = await wa.downloadContentFromMessage(node,normalized.mediaType);
                    const chunks = [];
                    let size = 0;
                    try {
                        for await (const chunk of stream) {
                            size += chunk.length;
                            if (size > config.maxMediaBytes) throw new Error('Anexo acima do limite de mídia.');
                            chunks.push(chunk);
                        }
                    } finally { stream.destroy(); }
                    return {buffer:Buffer.concat(chunks),mimetype:node.mimetype || ({image:'image/jpeg',video:'video/mp4',sticker:'image/webp',audio:'audio/ogg'}[normalized.mediaType]),type:normalized.mediaType};
                })();
                normalized.react = async emoji => {
                    try {
                        if (stopping || socket !== currentSocket) return;
                        logger.zap(`Reagindo com "${emoji || 'remover'}" na mensagem ${raw.key.id}`);
                        await currentSocket.sendMessage(normalized.transportJid, { react: { text: String(emoji || ''), key: raw.key } });
                    } catch {}
                };
                normalized.delete = async () => {
                    try {
                        if (stopping || socket !== currentSocket) return false;
                        logger.zap(`Excluindo mensagem ${raw.key.id} no chat ${normalized.transportJid}`);
                        await currentSocket.sendMessage(normalized.transportJid, { delete: raw.key });
                        return true;
                    } catch (err) {
                        logger.warn(`Não foi possível excluir a mensagem: ${err.message}`);
                        return false;
                    }
                };
                let readReceiptAttempted = false;
                normalized.send = async (payload, options = {}) => {
                    const targetJid = options.targetJid || payload.targetJid || normalized.transportJid;
                    const sendReply = async content => {
                        if (stopping || socket !== currentSocket) throw new Error('Conexão WhatsApp interrompida; tente novamente após reconectar.');
                        logger.zap(`Enviando resposta para ${targetJid}: ${typeof content.text === 'string' ? content.text.slice(0, 160) : Object.keys(content).join(', ')}`);
                        const sent = await sendLimited(currentSocket,targetJid,content,targetJid === normalized.transportJid ? {quoted:raw} : {});
                        if (sent?.key?.id) {
                            sentMessageKeys.add(`${targetJid}:${sent.key.id}`);
                            if (sentMessageKeys.size > 2000) sentMessageKeys.delete(sentMessageKeys.values().next().value);
                        }
                        if (!readReceiptAttempted && targetJid === normalized.transportJid && !stopping && socket === currentSocket) {
                            readReceiptAttempted = true;
                            try { await currentSocket.readMessages([raw.key]); }
                            catch { logger.warn('Resposta enviada, mas não foi possível confirmar a leitura da mensagem.'); }
                        }
                        return sent;
                    };
                    for (const value of Object.values(payload)) if (Buffer.isBuffer(value) && value.length > config.maxMediaBytes) throw new Error('Arquivo acima do limite de envio.');
                    if (typeof payload.text === 'string') {
                        return sendReply({text:payload.text.slice(0,24000)});
                    }
                    const cleanPayload = {...payload};
                    delete cleanPayload.targetJid;
                    return sendReply(cleanPayload);
                };
                router.handle(normalized).catch(err => logger.error('Falha ao processar mensagem WhatsApp:', err));
            }
        });
    }
    const stop = async () => { halt('Hikari Zap encerrada.'); await saveChain; identities.flush(); releaseLock(); };
    process.once('SIGINT',() => stop().finally(() => process.exit(0)));
    process.once('SIGTERM',() => stop().finally(() => process.exit(0)));
    try { await connect(); } catch (error) {
        await stop();
        throw error;
    }
    return {stop,router};
}
module.exports = { start, normalizeIncoming, chatJid };
