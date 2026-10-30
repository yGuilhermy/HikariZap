const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../config');
const {logger} = require('../utils/logger');
function run(command, args, {signal, timeout = 120000, maxOutput = 1048576} = {}) {
    return new Promise((resolve, reject) => {
        logger.media(`Executando processo: ${command} ${args.slice(0, 5).join(' ')}...`);
        const child = spawn(command, args, {stdio: ['ignore','pipe','pipe'], signal});
        let stdout = '', stderr = '', settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Tempo de processamento excedido.')); }, timeout);
        child.stdout.on('data', data => { stdout = (stdout + data).slice(-maxOutput); });
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
        child.on('error', error => { logger.warn(`Erro no processo ${command}: ${error.message}`); finish(error); });
        child.on('close', code => {
            if (code !== 0) logger.warn(`Processo ${command} encerrou com código ${code}. Erro: ${(stderr || stdout).trim().slice(-400)}`);
            else logger.media(`Processo ${command} finalizado com sucesso (código 0).`);
            finish(code === 0 ? null : new Error(`Falha em ${command} (${code}).`), {stdout, stderr});
        });
    });
}
function supportedUrl(raw) {
    try {
        const url = new URL(raw);
        const hosts = ['youtube.com','youtu.be','instagram.com','tiktok.com','twitter.com','x.com'];
        return ['http:','https:'].includes(url.protocol) && !url.username && !url.password && !url.port && hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
    } catch { return false; }
}
function hasCookieForHost(cookiePath, host) {
    try {
        if (!cookiePath || !fs.existsSync(cookiePath)) return false;
        const base = host.replace(/^(?:www\.|music\.)/i, '');
        return fs.readFileSync(cookiePath, 'utf8').includes(base);
    } catch { return false; }
}

async function download(url, type, signal) {
    if (!supportedUrl(url)) throw new Error('Envie um link de YouTube, Instagram, TikTok ou X.');
    let targetUrl = url;
    let targetHost = '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'music.youtube.com') {
            parsed.hostname = 'www.youtube.com';
            targetUrl = parsed.toString();
        }
        targetHost = parsed.hostname;
    } catch (_) {}
    logger.media(`Iniciando download (${type}) via yt-dlp para: ${targetUrl}`);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-zap-'));
    const cleanup = () => fs.rmSync(directory, {recursive: true, force: true});
    try {
        const args = ['--ignore-config','--no-playlist','--no-exec','--no-write-thumbnail','--max-filesize', String(config.maxMediaBytes), '--socket-timeout','20','--retries','3','--restrict-filenames','--js-runtimes','node','--print','after_move:filepath','-o', path.join(directory, '%(title).80s.%(ext)s')];
        if (hasCookieForHost(config.ytdlpCookiesPath, targetHost)) args.push('--cookies', config.ytdlpCookiesPath);
        if (type === 'audio') args.push('-f','bestaudio/best','-x','--audio-format','mp3');
        else args.push('-f','bestvideo[height<=1080]+bestaudio/best[height<=1080]/best','--recode-video','mp4');
        args.push('--', targetUrl);
        await run(config.ytdlpPath || 'yt-dlp', args, {signal});
        const files = fs.readdirSync(directory).filter(x => x.endsWith(type === 'audio' ? '.mp3' : '.mp4'));
        if (!files.length) throw new Error('Nenhum arquivo disponível dentro do limite.');
        const filePath = path.join(directory, files[0]);
        const fileName = path.basename(filePath);
        const sizeMb = (fs.statSync(filePath).size / 1048576).toFixed(2);
        if (fs.statSync(filePath).size > config.maxMediaBytes) throw new Error('O arquivo excede o limite de envio.');
        logger.media(`Download concluído: ${filePath} (${sizeMb} MB)`);
        return {filePath, fileName, cleanup};
    } catch (error) { cleanup(); throw error; }
}
async function toWav(buffer, signal) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-stt-'));
    try {
        const input = path.join(directory,'input');
        const output = path.join(directory,'audio.wav');
        fs.writeFileSync(input, buffer);
        await run(config.ffmpegPath || 'ffmpeg', ['-hide_banner','-loglevel','error','-i',input,'-t','60','-ar','16000','-ac','1',output], {signal, timeout: 20000});
        return fs.readFileSync(output);
    } finally { fs.rmSync(directory, {recursive:true, force:true}); }
}
module.exports = { run, supportedUrl, download, toWav };
