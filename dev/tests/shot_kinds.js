// Test-only, NOT part of run_all.js: a one-off screenshot helper from 24 Nov, kept for
// reference. It took a headless screenshot of the kinds of request (story / Summarize / script) in PromptAssay.
// Its paths (/tmp files and ../tools) are from the old workspace: fix them before reuse.
'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync('/tmp/pa_t.json',fs.readFileSync('/tmp/pa_k.json','utf8'));
  const pa=spawn(process.execPath,[path.join(__dirname,'..','tools','promptassay','promptassay.js')],{env:{...process.env,PA_SETTINGS:'/tmp/pa_t.json'}});
  let out='';pa.stdout.on('data',d=>out+=d);await sleep(800);
  const url=out.match(/window: (\S+)/)[1];
  const ch=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9336','--user-data-dir=/tmp/chr_t','--window-size=1400,600','about:blank']);
  await sleep(1500);
  const t=(await (await fetch('http://127.0.0.1:9336/json')).json()).find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
  let id=0;const w=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(w.has(m.id)){w.get(m.id)(m);w.delete(m.id)}});
  const send=(m,p={})=>new Promise(r=>{const i=++id;w.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))});
  await send('Page.enable');await send('Page.navigate',{url:url+'/?session='+encodeURIComponent('1:run_2026-11-20T17-42-53-582Z')+'&n=2673'});await sleep(6000);
  const r=await send('Runtime.evaluate',{expression:"JSON.stringify({n:document.querySelectorAll('#timeline .tick').length,first:[...document.querySelectorAll('#timeline .tick')].slice(0,4).map(b=>b.dataset.tick),total:document.querySelectorAll('#timeline button').length})",returnByValue:true});
  console.log(r.result.result.value);
  const s=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1400,height:500,scale:1}});
  fs.writeFileSync(path.join(__dirname,'pa_kinds.png'),Buffer.from(s.result.data,'base64'));
  ch.kill();pa.kill();process.exit(0);
})();
