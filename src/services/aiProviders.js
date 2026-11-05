const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const config = require('../config');
const {logger} = require('../utils/logger');
const unique = values => [...new Set(values.map(x=>String(x||'').trim()).filter(Boolean))];
const split = value => unique(String(value||'').split(','));
const fingerprint = value => createHash('sha256').update(String(value||'anonymous')).digest('hex').slice(0,20);
const safeModel = value => String(value).replace(/[^a-zA-Z0-9_./:-]/g,'').slice(0,160);
const number = (value,fallback,min,max) => Math.max(min,Math.min(max,Number(value)||fallback));
function serviceId(provider) {
    try { return provider.family+':'+new URL(provider.url).origin; } catch { return provider.family; }
}
function scopes(provider,withTools) {
    const service=serviceId(provider),key=fingerprint(provider.key);
    return {service:'service:'+service,credential:`credential:${service}:${key}`,model:`model:${service}:${provider.model}`,pair:`pair:${service}:${provider.model}:${key}`,tools:`tools:${service}:${provider.model}:${key}:${withTools?'yes':'no'}`};
}
function errorKind(error) {
    const status=Number(error.response?.status)||0;
    const body=error.response?.data;
    const detail=Array.isArray(body)?body[0]?.error:body?.error;
    const message=String(typeof detail==='string'?detail:detail?.message||'');
    if([400,403,404].includes(status)&&(/model[^\n]{0,120}(?:not found|no longer|decommissioned|does not exist|not permitted|not allowed|restricted|not authorized)/i.test(message)||/model_(?:decommissioned|not_found|permission)/i.test(String(detail?.code||''))))return {kind:'model',status,ms:21600000};
    if(status===401||status===403||status===402||/API key not valid|invalid_api_key|authentication_error/i.test(message)) return {kind:'credential',status,ms:3600000};
    if(status===404) return {kind:'model',status,ms:21600000};
    if(status===429) {
        const daily=/per.?day|daily|billing|insufficient_quota|quota[^\n]{0,100}limit[\s:]+0/i.test(message+JSON.stringify(detail?.details||[]));
        return {kind:daily?'daily-quota':'rate-limit',status,ms:daily?3600000:60000};
    }
    if(status===400&&/does not support.*(?:tool|function)|(?:tool|function)[\s\S]{0,60}(?:not supported|unsupported|not available)/i.test(message)) return {kind:'tool-support',status,ms:3600000};
    if(status===503||status===502||status===500||status===504) return {kind:'capacity',status,ms:30000};
    if(['ECONNABORTED','ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN'].includes(error.code))return {kind:'network',status,ms:15000};
    return {kind:'request',status,ms:30000};
}
function retryDelay(error) {
    const header=error.response?.headers?.['retry-after'];
    let delay=Number(header)*1000;
    if(header&&!Number.isFinite(delay))delay=Date.parse(header)-Date.now();
    const body=error.response?.data;
    const detail=Array.isArray(body)?body[0]?.error:body?.error;
    for(const item of (Array.isArray(detail?.details)?detail.details:[])) {
        if(typeof item.retryDelay==='string'&&/^\d+(?:\.\d+)?s$/.test(item.retryDelay))delay=Math.max(delay||0,parseFloat(item.retryDelay)*1000);
    }
    return Number.isFinite(delay)?Math.max(0,delay):0;
}
class ProviderPool {
    constructor({file}={}) {
        this.health=new Map();this.cursor=new Map();this.inflight=new Set();this.lastWinner=null;this.timer=null;this.dirty=false;
        this.file=file===undefined?path.join(config.dataDir,'ai-health.json'):file;
        try {
            const saved=this.file?JSON.parse(fs.readFileSync(this.file,'utf8')):{};
            if(saved.version===1)for(const [id,state] of Object.entries(saved.entries||{})) {
                if(state&&state.until>Date.now()&&state.until<=Date.now()+86400000&&typeof state.kind==='string')this.health.set(id,{until:state.until,kind:state.kind,failures:Number(state.failures)||1});
            }
        } catch(error) { if(error.code!=='ENOENT')logger.warn('Cache de disponibilidade IA ignorado; será reconstruído sem credenciais.'); }
        this.onExit=()=>this.flush();
        process.once('exit',this.onExit);
    }
    flush() {
        clearTimeout(this.timer);this.timer=null;
        if(!this.file||!this.dirty)return;
        const entries=Object.fromEntries([...this.health].filter(([,state])=>state.until>Date.now()));
        try {
            fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
            fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,entries}),{mode:0o600});
            fs.renameSync(this.file+'.tmp',this.file);
            this.dirty=false;
        } catch { logger.warn('Não foi possível salvar disponibilidade IA; mantendo o controle em memória.'); }
    }
    close() {this.flush();process.removeListener('exit',this.onExit);}
    persist() { this.dirty=true;if(this.file&&!this.timer){this.timer=setTimeout(()=>this.flush(),500);this.timer.unref();} }
    remaining(provider,withTools) {
        const now=Date.now();
        return Math.max(0,...Object.values(scopes(provider,withTools)).map(id=>(this.health.get(id)?.until||0)-now));
    }
    chooseKey(family,url,keys) {
        const values=unique(keys),cursor=this.cursor.get(family)||0;
        for(let n=0;n<values.length;n++) {
            const index=(cursor+n)%values.length,key=values[index];
            const id=scopes({family,url,key,model:''},false).credential;
            if((this.health.get(id)?.until||0)>Date.now())continue;
            this.cursor.set(family,index+1);return key;
        }
        return null;
    }
    candidates(withTools) {
        const sets={};
        if(config.localLlmEnabled)sets.local=[{family:'local',url:config.localLlmUrl,model:config.localLlmModel,key:config.lmStudioApiKey}];
        const geminiKeys=unique(config.geminiApiKeys||[]);
        sets.gemini=config.getGeminiModels().map(model=>({family:'gemini',url:config.geminiUrl,model,key:this.chooseKey('gemini',config.geminiUrl,geminiKeys)})).filter(p=>p.key);
        const groqUrl='https://api.groq.com/openai/v1/chat/completions';
        const groqKeys=split(process.env.GROQ_CHAT_ENABLED==='true' ? process.env.GROQ_CHAT_API_KEY : '');
        sets.groq=(config.groqModels||[]).map(model=>({family:'groq',url:groqUrl,model,key:this.chooseKey('groq',groqUrl,groqKeys)})).filter(p=>p.key);
        sets.huggingface=config.hfToken?(config.hfModels||[config.hfModel]).map(model=>({family:'huggingface',url:config.hfApiUrl,model,key:config.hfToken})):[];
        sets.pollinations=(process.env.POLLINATIONS_API_KEY||process.env.ALLOW_PUBLIC_POLLINATIONS==='true')?[{family:'pollinations',url:process.env.POLLINATIONS_TEXT_URL||'https://text.pollinations.ai/openai',model:process.env.POLLINATIONS_MODEL||'openai',key:process.env.POLLINATIONS_API_KEY}]:[];
        const order=unique(['gemini',...(config.aiProviderOrder||['groq','huggingface','pollinations']),'local']);
        const candidates=order.flatMap(family=>sets[family]||[]);
        return candidates;
    }
    markFailure(provider,withTools,error) {
        const info=errorKind(error),ids=scopes(provider,withTools);
        const scope=info.kind==='credential'?ids.credential:info.kind==='tool-support'?ids.tools:
            ['rate-limit','daily-quota','capacity'].includes(info.kind)?ids.model:ids.pair;
        const previous=this.health.get(scope),failures=Math.min(6,(previous?.failures||0)+1);
        const transient=['rate-limit','capacity','network'].includes(info.kind);
        const backoff=transient?Math.min(900000,info.ms*2**(failures-1)):info.ms;
        const delay=Math.min(86400000,Math.max(backoff,retryDelay(error)));
        this.health.set(scope,{until:Date.now()+delay,kind:info.kind,failures});
        this.persist();
        const body=error.response?.data,detail=Array.isArray(body)?body[0]?.error:body?.error;
        let reason=typeof detail==='string'?detail:typeof detail?.message==='string'?detail.message:'';
        for(const key of unique([provider.key,...(config.geminiApiKeys||[])]))reason=reason.split(key).join('[REDACTED]');
        reason=reason.replace(/AIza[\w-]+/g,'[REDACTED]').replace(/https?:\/\/[^\s]+/g,url=>url.split('?')[0]).replace(/[\r\n]+/g,' ').slice(0,350);
        logger.warn(`IA ${provider.family}/${safeModel(provider.model)}: ${info.status||error.code||'resposta inválida'} (${info.kind})${reason?': '+reason:''}; pausa de ${Math.ceil(delay/1000)}s antes de nova tentativa nesse destino.`);
    }
    async complete(payload,signal,accept) {
        const withTools=Boolean(payload.tools?.length);
        const deadline=Date.now()+Math.max(config.llmCompletionBudget,this.candidates(withTools).length*config.llmAttemptTimeout);
        const attemptsByFamily=new Map();let attempts=0,earliest=Infinity;
        for(const provider of this.candidates(withTools)) {
            signal?.throwIfAborted();
            if(Date.now()>=deadline)break;
            const held=this.remaining(provider,withTools);
            if(held){earliest=Math.min(earliest,held);continue;}
            const count=attemptsByFamily.get(provider.family)||0;
            const identity=scopes(provider,withTools).pair;
            if(this.inflight.has(identity))continue;
            attempts++;attemptsByFamily.set(provider.family,count+1);this.inflight.add(identity);
            const request={...payload,model:provider.model};
            if(provider.family==='gemini'&&/^gemini-[34]/.test(provider.model))delete request.temperature;
            if(provider.family==='groq'){request.max_completion_tokens=request.max_tokens;delete request.max_tokens;}
            if(provider.family==='groq'&&/gpt-oss/.test(provider.model)){request.reasoning_effort='low';request.include_reasoning=false;}
            if(provider.family==='groq'&&/qwen\//.test(provider.model)){request.reasoning_effort='none';request.reasoning_format='hidden';}
            const timeout=Math.max(1,Math.min(config.llmTimeout,config.llmAttemptTimeout,deadline-Date.now()));
            try {
                logger.ai(`IA tentativa ${attempts}/${config.llmMaxAttempts}: ${provider.family}/${safeModel(provider.model)} (até ${Math.ceil(timeout/1000)}s).`);
                const response=await axios.post(provider.url,request,{headers:{'Content-Type':'application/json',...(provider.key?{Authorization:`Bearer ${provider.key}`}:{})},timeout,signal});
                signal?.throwIfAborted();
                const message=response.data?.choices?.[0]?.message;
                const result=message?accept(message):null;
                if(!result)throw Object.assign(new Error('Resposta sem conteúdo final.'),{code:'EMPTY_RESPONSE'});
                this.lastWinner={family:provider.family,model:provider.model,until:Date.now()+60000};
                logger.ai(`IA respondeu via ${provider.family}/${safeModel(provider.model)}.`);
                return result;
            } catch(error) {
                signal?.throwIfAborted();
                this.markFailure(provider,withTools,error);
                earliest=Math.min(earliest,this.remaining(provider,withTools));
            } finally { this.inflight.delete(identity); }
        }
        const seconds=Number.isFinite(earliest)?Math.max(5,Math.ceil(earliest/1000)):30;
        throw Object.assign(new Error(`Estou sem um modelo de IA disponível agora. Tente novamente em cerca de ${seconds<60?seconds+' segundos':Math.ceil(seconds/60)+' minuto(s)'}.`),{code:'AI_UNAVAILABLE',retryAfterMs:seconds*1000});
    }
    async generateGemini(payload,signal) {
        const deadline=Date.now()+Math.max(config.llmCompletionBudget,config.getGeminiModels().length*config.llmAttemptTimeout);
        let attempts=0;
        for(const model of config.getGeminiModels()) {
            signal?.throwIfAborted();
            const key=this.chooseKey('gemini',config.geminiUrl,config.geminiApiKeys);
            if(!key)break;
            const provider={family:'gemini',model,key,url:config.geminiUrl};
            if(this.remaining(provider,false))continue;
            if(Date.now()>=deadline)break;
            const identity=scopes(provider,false).pair;
            if(this.inflight.has(identity))continue;
            this.inflight.add(identity);attempts++;
            try {
                const response=await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,payload,
                    {headers:{'Content-Type':'application/json','x-goog-api-key':key},timeout:Math.max(1,Math.min(config.llmAttemptTimeout,deadline-Date.now())),signal});
                signal?.throwIfAborted();
                const text=response.data?.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('').trim();
                if(text)return text;
                throw Object.assign(new Error('Resposta multimodal vazia.'),{code:'EMPTY_RESPONSE'});
            } catch(error) {signal?.throwIfAborted();this.markFailure(provider,false,error);}
            finally {this.inflight.delete(identity);}
        }
        throw Object.assign(new Error('Gemini temporariamente indisponível para esta mídia. Tente novamente mais tarde.'),{code:'AI_UNAVAILABLE'});
    }
}
let instance;
const getPool=()=>instance||=(new ProviderPool());
module.exports={ProviderPool,getPool,errorKind,retryDelay};
