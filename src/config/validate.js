const fs = require('node:fs');
const path = require('node:path');
function findExecutable(command) {
    if(!command) return false;
    const extensions=process.platform==='win32'?['',...(process.env.PATHEXT||'.EXE;.CMD;.BAT').split(';')]:[''];
    const dirs=path.isAbsolute(command)||/[\\/]/.test(command)?['']:(process.env.PATH||'').split(path.delimiter);
    return dirs.some(dir=>extensions.some(ext=>{
        const file=dir?path.join(dir,command+ext):path.resolve(command+ext);
        try { fs.accessSync(file,process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return fs.statSync(file).isFile(); } catch { return false; }
    }));
}
function validateConfiguration(config) {
    const errors=[],warnings=[];
    if(!['awesomeapi','frankfurter'].includes(config.currencyProvider || 'awesomeapi'))errors.push('CURRENCY_PROVIDER: use awesomeapi ou frankfurter.');
    const number=(name,min,max,integer=false)=>{
        const raw=process.env[name];if(raw===undefined||!raw.trim())return;
        const value=Number(raw);
        if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) errors.push(`${name}: informe ${integer?'um inteiro':'um número'} entre ${min} e ${max}.`);
    };
    for(const name of ['SAVE_HISTORY','LOCAL_LLM_ENABLED','WHATSAPP_NOTIFY_OWNER'])if(process.env[name]&&!['true','false'].includes(process.env[name])) errors.push(`${name}: use true ou false.`);
    for(const [name,min,max,int] of [['WHATSAPP_MAX_MEDIA_MB',1,64,true],['LLM_TIMEOUT_MS',5000,120000,true],['VOICE_SPEED',0.5,2,false],['VOICE_TEMPERATURE',0,2,false],['VOICE_MAX_CHARS',1,5000,true],['LOG_RETENTION_DAYS',1,90,true],['LOG_MAX_FILE_MB',1,50,false]])number(name,min,max,int);
    if(process.env.LOG_LEVEL&&!['debug','info','warn','error'].includes(process.env.LOG_LEVEL))errors.push('LOG_LEVEL: use debug, info, warn ou error.');
    for(const name of ['GEMINI_URL','HF_API_URL','LOCAL_LLM_URL','MODAL_TTS_ENDPOINT','HF_TTS_ENDPOINT','POLLINATIONS_TEXT_URL','OPENAI_STT_URL','HF_STT_URL','LOCAL_STT_URL']) {
        if(!process.env[name])continue;
        try { const url=new URL(process.env[name]);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error(); }
        catch { errors.push(`${name}: informe uma URL HTTP ou HTTPS válida, sem credenciais embutidas.`); }
    }
    for(const part of (process.env.WHATSAPP_OWNER_NUMBERS||'').split(',').filter(x=>x.trim()))if(!/^\d{8,15}$/.test(part.replace(/[+()\s-]/g,'')))errors.push('WHATSAPP_OWNER_NUMBERS: use números completos com DDI e DDD; nomes e LIDs não concedem privilégios.');
    if(!config.ownerNumbers.length)warnings.push('Proprietário não configurado; comandos exclusivos do dono indisponíveis. O placeholder não concede acesso.');
    for(const [name,directory] of [['WHATSAPP_AUTH_DIR',config.authDir],['WHATSAPP_DATA_DIR',config.dataDir]]) {
        try { if(directory===path.parse(directory).root||fs.existsSync(directory)&&(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()))errors.push(`${name}: escolha uma pasta própria, sem links simbólicos.`); }
        catch { errors.push(`${name}: pasta inacessível.`); }
    }
    if(config.authDir===config.dataDir)errors.push('WHATSAPP_AUTH_DIR e WHATSAPP_DATA_DIR devem ser pastas diferentes.');
    const logDirectory=path.resolve(config.root,process.env.LOG_DIR||'logs'),relative=path.relative(config.root,logDirectory);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))errors.push('LOG_DIR: use uma subpasta do projeto, como logs.');
    else if(fs.existsSync(logDirectory)&&(!fs.lstatSync(logDirectory).isDirectory()||fs.lstatSync(logDirectory).isSymbolicLink()))errors.push('LOG_DIR: escolha uma pasta sem links simbólicos.');
    if(config.ytdlpCookiesPath&&!fs.existsSync(config.ytdlpCookiesPath))warnings.push('YTDLP_COOKIES_PATH não existe; downloads serão tentados sem cookies.');
    const ffmpeg=findExecutable(config.ffmpegPath),ytdlp=findExecutable(config.ytdlpPath),python=findExecutable(config.pythonPath);
    const capabilities={download:ffmpeg&&ytdlp,voice:ffmpeg&&Boolean(config.hfTtsEndpoint||config.modalTtsEndpoint),transcription:ffmpeg&&Boolean(config.geminiApiKeys.length||config.hfToken||process.env.GROQ_API_KEY||process.env.WITAI_TOKEN||process.env.OPENAI_STT_KEY||process.env.LOCAL_STT_URL),deezer:python&&Boolean(process.env.DEEZER_ARL)};
    if(!ffmpeg)warnings.push('FFMPEG_PATH não encontrado: conversão de mídia indisponível.');
    if(!ytdlp)warnings.push('YTDLP_PATH não encontrado: downloads de links indisponíveis.');
    if(!python)warnings.push('PYTHON_PATH não encontrado: download Deezer indisponível.');
    if(!capabilities.voice)warnings.push('Voz indisponível: configure um endpoint TTS e FFmpeg.');
    if(!capabilities.transcription)warnings.push('Transcrição indisponível: configure um provedor STT e FFmpeg.');
    if(!capabilities.deezer)warnings.push('Download Deezer indisponível: configure DEEZER_ARL e Python.');
    if(!config.localLlmEnabled&&!config.geminiApiKeys.length&&!config.hfToken&&!process.env.POLLINATIONS_API_KEY)warnings.push('IA sem credenciais configuradas; apenas o provedor alternativo público poderá ser tentado.');
    return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],capabilities};
}
module.exports={validateConfiguration,findExecutable};
