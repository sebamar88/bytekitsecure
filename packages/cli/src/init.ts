import { lstat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const agent = `import {createInterface} from 'node:readline';
let counter=0;
const emit=(type,payload,extra={})=>process.stdout.write(JSON.stringify({protocol:'causign/1',id:'sample_'+ ++counter,type,timestamp:new Date().toISOString(),payload,...extra})+'\\n');
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{const message=JSON.parse(line);
 if(message.type==='hello')emit('adapter.ready',{adapter:{name:'harmless-sample',version:'1'},supportedVersions:['causign/1'],capabilities:['observe.output']},{correlationId:message.id});
 if(message.type==='configure')emit('adapter.configured',{}, {correlationId:message.id});
 if(message.type==='run.start'){emit('run.started',{}, {runId:message.runId,correlationId:message.id});emit('run.completed',{output:{greeting:'Hello from Causign'}},{runId:message.runId});lines.close();process.stdin.destroy();}
});
`;
export async function initialize(directory: string): Promise<string[]> {
  const files: Record<string, string> = {
    "causign.config.ts": `// Config/scenario imports execute local user code; inspect is not a security sandbox.\nexport default {schemaVersion:'1',agents:{sample:{command:process.execPath,args:['sample-agent.mjs'],cwd:'.'}},evaluators:{}};\n`,
    "sample.causign.ts": `// A declarative, harmless starter. Export one scenario, a list, or collector.definitions.\nexport default {schemaVersion:'1',id:'sample-greeting',name:'Sample greeting',agent:'sample',input:null,mocks:[],assertions:[{id:'greeting',type:'output.equal',parameters:{value:{greeting:'Hello from Causign'}},negated:false,requirements:[]}],requirements:[],timeoutMs:5000};\n`,
    "sample-agent.mjs": agent,
  };
  // Preflight all destinations, including directories and dangling symlinks.
  for (const name of Object.keys(files)) {
    try {
      await lstat(resolve(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Refusing to overwrite ${resolve(directory, name)}`);
  }
  const written: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(directory, name);
    await writeFile(path, content, { flag: "wx" });
    written.push(path);
  }
  return written;
}
