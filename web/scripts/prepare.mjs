import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/samples',{recursive:true});
await cp('../samples','public/samples',{recursive:true});
