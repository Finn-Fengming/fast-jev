#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const argv = process.argv.slice(2);
const live = argv.includes('--input-format');
const start = performance.now();
const timeline = [];
let pending = '';
function save(kind, extra = {}) {
  if (!live) return;
  appendFileSync('/private/tmp/fast-jev-agy-dev-events.jsonl', JSON.stringify({kind, elapsed_ms: Math.round(performance.now()-start), ...extra})+'\n');
}
save('started');
const child = spawn('agy', argv, {stdio:['inherit','pipe','pipe']});
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  if (!live) return;
  pending += chunk.toString();
  let index;
  while ((index=pending.indexOf('\n'))>=0) {
    const line=pending.slice(0,index); pending=pending.slice(index+1);
    try {
      const event=JSON.parse(line);
      const kind=['init','result','message','tool_call','tool_result'].includes(event.event)?event.event:'other_event';
      save(kind,event.event==='result'?{success:event.result?.status==='SUCCESS',has_structured_output:Object.hasOwn(event.result??{},'structured_output'),backend_seconds:Number.isFinite(event.result?.duration_seconds)?event.result.duration_seconds:null}:{});
    } catch {}
  }
});
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close',(code,signal)=>{save('closed',{code,signal});process.exitCode=code??1;});
