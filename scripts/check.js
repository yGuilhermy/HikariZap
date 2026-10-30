const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? (e.name === 'data' ? [] : walk(path.join(dir,e.name))) : e.name.endsWith('.js') ? [path.join(dir,e.name)] : []); }
const files = ['index.js',...walk('src'),...walk('scripts'),...walk('tests/zap')];
let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if (result.status) { console.error(result.stderr); failed = true; }
    if (/require\(['"](?:discord\.js|@discordjs\/)/.test(fs.readFileSync(file,'utf8'))) { console.error('Dependência Discord:',file); failed = true; }
}
console.log(`${files.length} arquivos verificados.`);
process.exitCode = failed ? 1 : 0;
