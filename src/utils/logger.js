const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const root = path.resolve(__dirname,'../..');
require('dotenv').config({path:path.join(root,'.env')});

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    gray: '\x1b[90m',
    red: '\x1b[91m',
    redBold: '\x1b[91;1m',
    green: '\x1b[92m',
    greenBold: '\x1b[92;1m',
    yellow: '\x1b[93m',
    yellowBold: '\x1b[93;1m',
    blue: '\x1b[94m',
    blueBold: '\x1b[94;1m',
    magenta: '\x1b[95m',
    magentaBold: '\x1b[95;1m',
    cyan: '\x1b[96m',
    cyanBold: '\x1b[96;1m',
    white: '\x1b[97m',
    whiteBold: '\x1b[97;1m'
};

const CATEGORIES = {
    SYSTEM: { tag: 'SYSTEM', color: ANSI.cyanBold },
    ZAP: { tag: 'ZAP', color: ANSI.blueBold },
    COMMAND: { tag: 'COMMAND', color: ANSI.greenBold },
    AI: { tag: 'AI/LLM', color: ANSI.magentaBold },
    HISTORICO: { tag: 'HISTORICO', color: ANSI.magentaBold },
    MEDIA: { tag: 'MEDIA', color: ANSI.greenBold },
    VOICE: { tag: 'VOICE', color: ANSI.cyan },
    SEARCH: { tag: 'SEARCH', color: ANSI.blue },
    MUSIC: { tag: 'MUSIC', color: ANSI.magenta },
    SECURITY: { tag: 'SECURITY', color: ANSI.yellowBold },
    WARN: { tag: 'WARN', color: ANSI.yellowBold },
    ERROR: { tag: 'ERROR', color: ANSI.redBold },
    INFO: { tag: 'INFO', color: ANSI.white }
};

const hiddenKeys = /key|token|password|secret|authorization|cookie|arl|webhook/i;
let initialized = false, diskFailed = false, lastPrune = 0;

function isSignalNoise(text) {
    return /Failed to decrypt message with any known session|Session error:Error: Bad MAC|Bad MAC|SessionCipher|doDecryptWhisperMessage|decryptWithSessions|queue_job\.js|session_cipher\.js|Closing session:|Opening session:|Session already closed|Session already open|Decrypted message with closed session|Closing open session in favor of incoming prekey bundle/i.test(text);
}

function installSignalFilter() {
    const origErr = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origInfo = console.info.bind(console);
    console.error = (...args) => {
        const text = args.map(a => typeof a === 'string' ? a : (a?.stack || a?.message || util.inspect(a))).join(' ');
        if (isSignalNoise(text)) return;
        origErr(...args);
    };
    console.warn = (...args) => {
        const text = args.map(a => typeof a === 'string' ? a : (a?.stack || a?.message || util.inspect(a))).join(' ');
        if (isSignalNoise(text)) return;
        origWarn(...args);
    };
    console.info = (...args) => {
        const text = args.map(a => typeof a === 'string' ? a : (a?.stack || a?.message || util.inspect(a))).join(' ');
        if (isSignalNoise(text)) return;
        origInfo(...args);
    };
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = function (chunk, encoding, cb) {
        const str = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
        if (isSignalNoise(str)) {
            if (typeof cb === 'function') cb();
            return true;
        }
        return origStderrWrite(chunk, encoding, cb);
    };
}
installSignalFilter();

function sanitize(value) {
    if (typeof value !== 'string') value = String(value);
    const secrets = Object.entries(process.env).filter(([key,val]) => hiddenKeys.test(key) && val && val.length >= 6)
        .flatMap(([,val]) => [val,...val.split(',').map(x=>x.trim())]).filter(x=>x.length>=6).sort((a,b)=>b.length-a.length);
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
    return value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
        .replace(/AIza[\w-]{20,}/g,'[REDACTED]')
        .replace(/((?:api[_-]?key|token|password|secret|arl|authorization|cookie)\s*[=:]\s*)[^\s,}]+/gi,'$1[REDACTED]');
}

function safeValue(value, depth = 0, seen = new WeakSet()) {
    if (value instanceof Error) return {name:value.name,message:sanitize(value.message),code:value.code,stack:value.stack};
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
    if (seen.has(value) || depth > 3) return '[Object]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0,15).map(x => safeValue(x,depth+1,seen));
    return Object.fromEntries(Object.entries(value).slice(0,30).map(([k,v]) => [k, hiddenKeys.test(k) ? '[REDACTED]' : safeValue(v,depth+1,seen)]));
}

function getTimeString() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function settings() {
    const selected = path.resolve(root,process.env.LOG_DIR||'logs');
    const relative = path.relative(root,selected);
    const directory = !relative||relative.startsWith('..')||path.isAbsolute(relative)?path.join(root,'logs'):selected;
    return {directory,days:Math.max(1,Math.min(90,Number(process.env.LOG_RETENTION_DAYS)||7)),bytes:Math.max(1,Math.min(50,Number(process.env.LOG_MAX_FILE_MB)||5))*1048576};
}

function ownFile(file) { try { const st=fs.lstatSync(file); return st.isFile()&&!st.isSymbolicLink(); } catch { return false; } }

function prune(directory,days) {
    if (Date.now()-lastPrune<3600000) return;
    lastPrune=Date.now();
    for(const name of fs.readdirSync(directory)) {
        if(!/^(hikari|errors)-\d{4}-\d{2}-\d{2}(?:\.[12])?\.log$/.test(name)) continue;
        const file=path.join(directory,name);
        if(ownFile(file)&&Date.now()-fs.statSync(file).mtimeMs>days*86400000) fs.unlinkSync(file);
    }
}

function append(file,line,maxBytes) {
    if (ownFile(file)&&fs.statSync(file).size+Buffer.byteLength(line)>maxBytes) {
        const first=file.replace(/\.log$/,'.1.log'),second=file.replace(/\.log$/,'.2.log');
        if(ownFile(second)) fs.unlinkSync(second);
        if(ownFile(first)) fs.renameSync(first,second);
        fs.renameSync(file,first);
    }
    fs.appendFileSync(file,line,{mode:0o600});
}

function emit(catKey, level, ...args) {
    const cat = CATEGORIES[catKey] || CATEGORIES.INFO;
    let errStack = null;
    const parts = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            errStack = arg.stack || arg.message;
            parts.push(arg.message);
        } else if (typeof arg === 'object' && arg !== null) {
            parts.push(util.inspect(safeValue(arg), { depth: 3, colors: false, breakLength: Infinity }));
        } else {
            parts.push(sanitize(String(arg)));
        }
    }
    const text = parts.join(' ');
    const timeFormatted = `${ANSI.white}[${getTimeString()}]${ANSI.reset}`;
    const tagFormatted = `${cat.color}[${cat.tag.padEnd(9)}]${ANSI.reset}`;
    const levelFormatted = level === 'ERROR' ? `${ANSI.redBold}[ERR]${ANSI.reset} ` : level === 'WARN' ? `${ANSI.yellowBold}[WRN]${ANSI.reset} ` : '';
    const lineOutput = `${timeFormatted} ${tagFormatted} ${levelFormatted}${text}\n`;
    if (level === 'ERROR') process.stderr.write(lineOutput);
    else process.stdout.write(lineOutput);
    if (errStack) process.stderr.write(`${ANSI.red}${sanitize(errStack)}${ANSI.reset}\n`);

    try {
        const at = new Date().toISOString();
        const {directory,days,bytes} = settings();
        fs.mkdirSync(directory,{recursive:true,mode:0o700});
        prune(directory,days);
        const diskLine = JSON.stringify({time:at,category:cat.tag,level,message:text})+'\n';
        append(path.join(directory,`hikari-${at.slice(0,10)}.log`),diskLine,bytes);
        if (level === 'ERROR') append(path.join(directory,`errors-${at.slice(0,10)}.log`),diskLine,bytes);
        diskFailed = false;
        initialized = true;
    } catch {
        diskFailed = true;
    }
}

const logger = {
    CATEGORIES,
    system: (...args) => emit('SYSTEM', 'INFO', ...args),
    zap: (...args) => emit('ZAP', 'INFO', ...args),
    command: (...args) => emit('COMMAND', 'INFO', ...args),
    ai: (...args) => emit('AI', 'INFO', ...args),
    historico: (...args) => emit('HISTORICO', 'INFO', ...args),
    media: (...args) => emit('MEDIA', 'INFO', ...args),
    voice: (...args) => emit('VOICE', 'INFO', ...args),
    search: (...args) => emit('SEARCH', 'INFO', ...args),
    music: (...args) => emit('MUSIC', 'INFO', ...args),
    security: (...args) => emit('SECURITY', 'WARN', ...args),
    warn: (...args) => emit('WARN', 'WARN', ...args),
    error: (...args) => emit('ERROR', 'ERROR', ...args),
    info: (...args) => emit('INFO', 'INFO', ...args),
    debug: (...args) => emit('INFO', 'DEBUG', ...args),
    tool: (...args) => emit('AI', 'INFO', ...args),
    image: (...args) => emit('MEDIA', 'INFO', ...args),
    vision: (...args) => emit('AI', 'INFO', ...args)
};

module.exports = {
    logger,
    sanitize,
    sanitizePaths: sanitize,
    flush: async () => {},
    get initialized() { return initialized; }
};
