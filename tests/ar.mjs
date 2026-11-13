import puppeteer from 'puppeteer-core';
const B='http://localhost:8766/';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push('pageerror '+e.message)); page.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') errors.push(m.type()+': '+m.text()); });
await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
await page.goto(B+'index.html#/measure',{waitUntil:'networkidle0'});
console.log('  SEM:', await page.evaluate(()=>window.semReady));
await sleep(800);
const st=await page.$eval('#arSupportStatus',e=>e.textContent); ok(!(await page.$eval('#btnStartAR',e=>e.disabled)),'에뮬레이터에서 AR 지원 감지: '+st);
// 장치를 바닥 쪽으로 50° 숙인 자세로
await page.evaluate(()=>{ const t=-50*Math.PI/180; xrDevice.position.set(0,1.4,0); xrDevice.quaternion.set(Math.sin(t/2),0,0,Math.cos(t/2)); });
await page.click('#btnStartAR'); await sleep(2500);
// 에뮬레이터는 실제 dom-overlay 대신 자체 캔버스를 최상단에 그리므로, 테스트에서만 오버레이를 위로 올림
await page.addStyleTag({content:'#arOverlay{z-index:2147483647 !important}'});
const err=await page.$eval('#arSupportStatus',e=>e.textContent);
const overlay=await page.$eval('#arOverlay',e=>!e.hidden); ok(overlay,'AR 세션 시작 & 오버레이 표시 '+(overlay?'':err));
if(!overlay){console.log(errors.join('\n')); await browser.close(); process.exit(1);}
let status=await page.$eval('#arStatus',e=>e.textContent); console.log('  상태:',status);
// 평면 인식 전 점 추가 거부 확인은 레디 전 타이밍 의존이라 상태 문자열로 확인
for(let i=0;i<20 && !status.includes('시작점');i++){ await sleep(300); status=await page.$eval('#arStatus',e=>e.textContent); }
ok(status.includes('시작점'),'평면 인식 후 측정 허용: '+status);
const feats=await page.evaluate(()=>{const a=__app.getAR(); return {anchors:a.anchorsSupported, cam:a.cameraAccess};}); console.log('  기능:',JSON.stringify(feats));
await page.screenshot({path:'shots/ar_01_ready.png'});
await page.click('#btnArAdd'); await sleep(400);
console.log('  debug:', await page.evaluate(()=>{const a=__app.getAR(); const b=document.getElementById('btnArAdd'); const r=b.getBoundingClientRect(); const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return JSON.stringify({ready:a.ready, hit:!!a.lastHitPos, dis:b.disabled, n:a.pointCount(), top: top && (top.id||top.tagName+'.'+top.className)});}));
const p1=await page.evaluate(()=>{const a=__app.getAR(); const p=a.chains[0][0].pos; return [p.x,p.y,p.z];}); console.log('  시작점:',p1.map(v=>v.toFixed(3)).join(','));
// 장치를 오른쪽으로 정확히 0.5 m 평행 이동
await page.evaluate(()=>{ xrDevice.position.set(0.5,1.4,0); }); await sleep(1200);
const live=await page.$eval('#arLive',e=>e.textContent); console.log('  실시간 미리보기:',live);
await page.click('#btnArAdd'); await sleep(500);
const r=await page.evaluate(()=>{const a=__app.getAR(); const s=a.segments(); return {n:s.length, L:s[0]&&s[0].lengthM, b:s[0]&&[s[0].b.x,s[0].b.y,s[0].b.z]};});
console.log('  종료점:',r.b&&r.b.map(v=>v.toFixed(3)).join(','),' 거리(m):',r.L);
ok(r.n===1 && Math.abs(r.L-0.5)<0.005,'0.5 m 이동 → 측정 거리 '+(r.L*100).toFixed(2)+' cm (기대 50 cm)');
const disp=await page.$eval('#arTotal',e=>e.textContent); const exp=(r.L*100).toFixed(1)+' cm'; ok(disp.includes('마지막 '+exp),'화면 표시: '+disp+' (기대 '+exp+')');
// 높이가 다른 두 점이 아닌 평면 내 3D 거리 / 연속 측정: 0.3 m 앞쪽으로
await page.evaluate(()=>{ xrDevice.position.set(0.5,1.4,-0.3); }); await sleep(1200);
await page.click('#btnArAdd'); await sleep(500);
const sum2=await page.evaluate(()=>__app.getAR().segments().reduce((n,s)=>n+s.lengthM,0));
let tot=await page.$eval('#arTotal',e=>e.textContent); ok(tot.includes('2개 구간')&&tot.includes((sum2*100).toFixed(1)+' cm')&&Math.abs(sum2-0.8)<0.03,'연속 측정 2구간 합계: '+tot+' (이동량 0.5+0.3 m)');
// 단위 변경
await page.click('#btnArUnit'); await sleep(300); const u1=await page.$eval('#arTotal',e=>e.textContent); ok(u1.includes('m'),'단위 변경 후: '+u1);
await page.click('#btnArUnit'); await page.click('#btnArUnit'); await sleep(200);
// 새 구간 + 되돌리기
await page.click('#btnArNewSeg'); await sleep(200);
await page.evaluate(()=>{ xrDevice.position.set(0,1.4,0); }); await sleep(1000); await page.click('#btnArAdd'); await sleep(300);
await page.evaluate(()=>{ xrDevice.position.set(0,1.4,-0.25); }); await sleep(1000); await page.click('#btnArAdd'); await sleep(300);
const segs3=await page.evaluate(()=>__app.getAR().segments().map(s=>[s.chain,s.lengthM]));
tot=await page.$eval('#arTotal',e=>e.textContent); ok(segs3.length===3&&segs3[2][0]===1&&Math.abs(segs3[2][1]-0.25)<0.02,'새 구간(별도 체인) 0.25 m: '+tot+' '+JSON.stringify(segs3.map(x=>[x[0],+x[1].toFixed(3)])));
await page.screenshot({path:'shots/ar_02_measured.png'});
await page.click('#btnArUndo'); await sleep(300); tot=await page.$eval('#arTotal',e=>e.textContent); ok(tot.includes('2개 구간'),'되돌리기: '+tot);
// 평면 없는 곳(하늘 방향)을 보면 측정 차단
// 방(스캔 환경) 밖 50 m 지점 → 레이가 어떤 표면에도 닿지 않음 = 평면 미인식 상황
await page.evaluate(()=>{ xrDevice.position.set(0,1.4,60); }); await sleep(1200);
const dis=await page.$eval('#btnArAdd',e=>e.disabled); status=await page.$eval('#arStatus',e=>e.textContent);
console.log('  위쪽을 볼 때 상태:',status,'버튼비활성:',dis);
await page.evaluate(()=>__app.getAR().addPoint()); await sleep(300);
const toastTxt=await page.$eval('#arToast',e=>e.textContent); const segCount=await page.evaluate(()=>__app.getAR().segments().length);
ok(segCount===2 && dis,'평면 미인식 시 점 추가 거부(임의값 없음): '+(dis?'버튼 비활성 ':'')+toastTxt);
// 저장 (사진 포함 설정 기본값)
await page.evaluate(()=>{ xrDevice.position.set(0,1.4,0); }); await sleep(800);
await page.click('#btnArSave'); await sleep(1500);
const saved=await page.evaluate(async()=>{const db=await import('./js/db.js'); const all=await db.getAllRecords(); const r=all[0]; return r?{type:r.type,total:r.totalM,n:r.segments.length,photo:r.photo?r.photo.size:0,ptype:r.photo&&r.photo.type}:null;});
console.log('  저장 결과:',JSON.stringify(saved));
ok(saved && saved.type==='length' && Math.abs(saved.total-sum2)<0.001 && saved.n===2 && saved.photo>1000,'측정 기록 + 측정 이미지 저장');
// 종료 → 결과 패널
await page.click('#btnArClose'); await sleep(1000);
ok(await page.$eval('#arOverlay',e=>e.hidden),'AR 종료');
ok(!(await page.$eval('#lastSessionPanel',e=>e.hidden)),'종료 후 방금 측정 결과 표시');
// 저장된 이미지 꺼내 보기
const b64=await page.evaluate(async()=>{const db=await import('./js/db.js'); const r=(await db.getAllRecords())[0]; const buf=await r.photo.arrayBuffer(); let s=''; const u=new Uint8Array(buf); for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s);});
(await import('fs')).writeFileSync('shots/ar_03_photo.jpg',Buffer.from(b64,'base64'));
await page.evaluate(async()=>{const db=await import('./js/db.js'); await db.clearRecords();});
const relevant=errors.filter(e=>!/IWER|DevUI|GPU stall|WebGL|swiftshader|Automatic fallback/i.test(e));
ok(relevant.length===0,'앱 오류 없음 '+JSON.stringify(relevant.slice(0,5)));
await browser.close(); process.exit(fails?1:0);
