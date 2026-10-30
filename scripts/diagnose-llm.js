const axios=require('axios');
const config=require('../src/config');
const tools=require('../src/data/mcp_tools.json');
const keys=[...new Set(config.geminiApiKeys)];
function safe(value) {
    let text=JSON.stringify(value);
    for(const key of keys)text=text.split(key).join('[REDACTED]');
    return text.replace(/AIza[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1800);
}
async function main(){
    const key=keys[0];
    if(!key)throw new Error('Sem chave Gemini.');
    if(process.argv.includes('--keys')) {
        for(const [index,key] of keys.entries()) {
            try {
                await axios.post(config.geminiUrl,{model:'gemini-3.1-flash-lite',messages:[{role:'user',content:'Responda OK.'}],max_tokens:64},{headers:{Authorization:`Bearer ${key}`},timeout:10000});
                console.log('KEY',index+1,'status=200');
            }catch(e){console.log('KEY',index+1,'status='+e.response?.status,safe(e.response?.data || {code:e.code}));}
        }
        return;
    }
    try {
        const {data}=await axios.get('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},timeout:15000});
        console.log('AVAILABLE_MODELS',safe(data.models?.filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name)));
    }catch(e){console.log('MODELS_ERROR',e.response?.status,safe(e.response?.data || {code:e.code}));}
    for(const model of config.getGeminiModels()) {
        for(const useTools of [false,true]) {
            try {
                const {data}=await axios.post(config.geminiUrl,{model,messages:[{role:'system',content:'Responda brevemente.'},{role:'system',content:'Responda só ao usuário.'},{role:'user',content:'Responda apenas OK.'}],temperature:0.65,max_tokens:1500,...(useTools?{tools,tool_choice:'auto'}:{})},{headers:{Authorization:`Bearer ${key}`},timeout:20000});
                console.log('PROBE',model,{useTools,status:200,hasContent:!!data.choices?.[0]?.message?.content});
            }catch(e){console.log('PROBE',model,{useTools,status:e.response?.status},safe(e.response?.data || {code:e.code}));}
        }
    }
}
main().catch(()=>{console.error('Falha no diagnóstico.');process.exitCode=1;});
