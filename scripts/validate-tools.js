const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../src/whatsapp/store');
const {createRouter} = require('../src/whatsapp/router');
const {createToolExecutor} = require('../src/whatsapp/tools');
const {executeAgentLoop} = require('../src/handlers/llmHandler');
async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-tool-check-'));
    const report = {at:new Date().toISOString(),mode:'provedores e ferramentas reais; transporte WhatsApp simulado',tests:[]};
    try {
        const store = new Store(dir),senderId = '5500000000001@s.whatsapp.net';
        store.accept(senderId);
        const executor = createToolExecutor();
        const cases = [
            {text:'Hikari, pesquise Node.js na web e me diga seu site oficial.',isGroup:true,expected:['search_web']},
            {text:'Consulte Portal 2 na Steam e converta 10 USD para BRL usando a cotação atual.',isGroup:false,expected:['check_steam','convert_currency']}
        ];
        for (const [i,entry] of cases.entries()) {
            const calls = [],outputs = [];
            let agentCompleted = false;
            const router = createRouter({store,agent:async(...args)=>{const result=await executeAgentLoop(...args);agentCompleted=true;return result;},executeTool:async(name,args,ctx) => {
                const result = await executor(name,args,ctx);
                calls.push({name,args,ok:!result?.error && (!Array.isArray(result) || result.length > 0),...(Array.isArray(result)?{resultCount:result.length}:{}),...(name==='search_web'?{officialNodeFound:result.some(x=>{try{return new URL(x.url).hostname==='nodejs.org';}catch{return false;}})}:{})});
                return result;
            }});
            await router.handle({id:`validation-${i}`,chatId:entry.isGroup?'120363000000000@g.us':senderId,senderId,isGroup:entry.isGroup,senderName:'Validação',text:entry.text,getMedia:async()=>null,send:async payload=>outputs.push(payload)});
            const passed = agentCompleted && entry.expected.every(name=>calls.some(x=>x.name===name&&x.ok)) && outputs.some(x=>x.text);
            report.tests.push({request:entry.text,isGroup:entry.isGroup,calls,agentCompleted,replyProduced:outputs.some(x=>x.text),passed});
        }
        report.passed = report.tests.every(x=>x.passed);
        const destination = path.resolve(__dirname,'../docs/whatsapp/VALIDACAO_TOOLS.json');
        fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
        console.log(JSON.stringify(report,null,2));
        if (!report.passed) process.exitCode = 1;
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error('Validação não concluída:',error.name);process.exitCode=1;});
