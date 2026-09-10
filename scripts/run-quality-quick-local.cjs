const fs=require('node:fs'),cp=require('node:child_process');
for(const line of fs.readFileSync('.env.quality-quick.local','utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]=m[2];}
const args=process.argv.slice(2);
const r=cp.spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
process.exitCode=r.status??1;
