import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const plugins={
  'paseo-ux':'paseo-ux',
  'paseo-aiw-companion':'aiw-companion',
  'paseo-codex-theme':'paseo-codex-theme',
};
function requireValue(condition,message){if(!condition)throw new Error(message);}
function walk(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  if(['node_modules','work'].includes(entry.name))return [];
  const path=join(directory,entry.name);
  requireValue(!entry.isSymbolicLink(),`Unexpected symlink: ${relative(root,path)}`);
  return entry.isDirectory()?walk(path):[path];
});}
for(const [directory,id] of Object.entries(plugins)){
  const path=resolve(root,'packages',directory);
  const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  const manifest=JSON.parse(readFileSync(join(path,'paseo-plugin.json'),'utf8'));
  requireValue(pkg.name===`@chlrc/${directory}`&&manifest.id===id,`Package identity: ${directory}`);
  requireValue(pkg.license==='MIT'&&pkg.publishConfig?.access==='public',`Package metadata: ${directory}`);
  requireValue(pkg.repository?.directory===`packages/${directory}`,`Repository metadata: ${directory}`);
  requireValue(pkg.files.includes('OVERVIEW.md')&&pkg.files.includes('LICENSE'),`Package files: ${directory}`);
  for(const file of walk(path)){
    const text=readFileSync(file,'utf8');
    requireValue(!/\/Users\/|\.feishu\.cn|\.larkoffice\.com|\.byted\.org|\.bytedance\.net|\bsk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text),`Private data marker: ${relative(root,file)}`);
  }
  if(process.argv.includes('--pack')){
    const [archive]=JSON.parse(execFileSync('npm',['pack','--dry-run','--ignore-scripts','--json'],{cwd:path,encoding:'utf8',stdio:['ignore','pipe','inherit']}));
    const files=archive.files.map(file=>file.path);
    for(const required of ['package.json','paseo-plugin.json','OVERVIEW.md','LICENSE'])requireValue(files.includes(required),`Missing packed ${required}: ${directory}`);
    requireValue(files.some(file=>/^index\.(client|server)\.tsx?$/.test(file)),`Missing runtime entry: ${directory}`);
    requireValue(files.every(file=>!/(^|\/)(tests|node_modules|work|validation\.json)(\/|$)/.test(file)),`Unexpected packed files: ${directory}`);
    console.log(`${pkg.name}@${pkg.version}: ${files.length} packed files`);
  }
}
console.log('Public source and package metadata checks passed.');
