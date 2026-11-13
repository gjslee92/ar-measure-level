import puppeteer from 'puppeteer-core';
import fs from 'fs';
const B='http://localhost:8765/';
let fails=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fails++;};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-fake-ui-for-media-stream']});
const page=await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.emulate({viewport:{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'});
const client=await page.target().createCDPSession();
await page.goto(B+'index.html',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,800));
ok(await page.$eval('[data-view=home]',e=>e.classList.contains('active')),'로그인 없이 메인 화면 바로 진입');
const pbox=await page.$eval('#platformBox',e=>e.innerText); console.log('  플랫폼:',pbox.replace(/\n/g,' | '));
await page.screenshot({path:'shots/01_home.png'});

// 수평기
// 실제 기기처럼 약 20Hz로 계속 이벤트를 발생시키는 스트리머(미세 지터 포함)
let cur=null, flip=1; const setOri=async(b,g)=>{cur={b,g};};
const streamer=setInterval(()=>{ if(!cur) return; flip=-flip; client.send('DeviceOrientation.setDeviceOrientationOverride',{alpha:0,beta:cur.b+flip*1e-4,gamma:cur.g}).catch(()=>{}); },50);
await setOri(0,0);
await page.goto(B+'index.html#/level'); await new Promise(r=>setTimeout(r,1500));
let big=await page.$eval('#bigAngle',e=>e.textContent); let st=await page.$eval('#levelState',e=>e.textContent);
ok(big==='0.0°','평면 0° 표시: '+big+' / '+st);
ok(st.includes('매우 정확'),'0° → 매우 정확한 수평 판정');
await page.screenshot({path:'shots/02_level_flat0.png'});
await setOri(0,5); await new Promise(r=>setTimeout(r,1800));
let a=await page.$eval('#valA',e=>e.textContent), da=await page.$eval('#dirA',e=>e.textContent); st=await page.$eval('#levelState',e=>e.textContent);
ok(a==='5.0°'&&da.includes('오른쪽'),`좌우 5° 기울기: ${a} ${da}`); ok(st.includes('기울어짐'),'5° → 기울어짐 판정');
await page.screenshot({path:'shots/03_level_flat5.png'});
await setOri(0,-10); await new Promise(r=>setTimeout(r,1800));
a=await page.$eval('#valA',e=>e.textContent); da=await page.$eval('#dirA',e=>e.textContent); ok(a==='10.0°'&&da.includes('왼쪽'),`좌우 -10°: ${a} ${da}`);
await setOri(3,0); await new Promise(r=>setTimeout(r,1800));
let b=await page.$eval('#valB',e=>e.textContent); ok(b==='3.0°','전후 3°: '+b);
await setOri(0,0.7); await new Promise(r=>setTimeout(r,1800));
st=await page.$eval('#levelState',e=>e.textContent); ok(st.includes('거의 수평'),'0.7° → 거의 수평: '+st);
// 영점 보정
await page.click('#btnZero'); await new Promise(r=>setTimeout(r,600));
await new Promise(r=>setTimeout(r,600));
big=await page.$eval('#bigAngle',e=>e.textContent); ok(big==='0.0°','영점 보정 후 0.0°: '+big);
const calib=await page.$eval('#calibLine',e=>e.textContent); console.log('  ',calib);
await setOri(0,0); await new Promise(r=>setTimeout(r,1800));
a=await page.$eval('#valA',e=>e.textContent); ok(a==='0.7°','보정 후 실제 0° → 0.7° 차이 표시: '+a);
await page.click('#btnResetCalib'); await new Promise(r=>setTimeout(r,400));
big=await page.$eval('#bigAngle',e=>e.textContent); ok(big==='0.0°','보정 초기화 후 0.0°');
// 세움 모드 (수직)
await setOri(90,0); await new Promise(r=>setTimeout(r,2000));
st=await page.$eval('#levelState',e=>e.textContent); big=await page.$eval('#bigAngle',e=>e.textContent);
ok(st.startsWith('수직'),'세로로 세움 → 수직 모드 자동 전환: '+st+' '+big);
await page.screenshot({path:'shots/04_level_vertical.png'});
// 가로 세움 + 2° 기울기: up=(−cosβ sinγ, sinβ, cosβ cosγ). β=2,γ=-90 → 가로
await setOri(2,-89.999); await new Promise(r=>setTimeout(r,2000));
st=await page.$eval('#levelState',e=>e.textContent); big=await page.$eval('#bigAngle',e=>e.textContent); const rot=await page.$eval('#valRot',e=>e.textContent);
ok(st.startsWith('수평')&&big==='2.0°',`가로 세움 2° → ${st} ${big} 회전각 ${rot}`);
await page.screenshot({path:'shots/05_level_horizontal.png'});
// 각도 고정 & 저장
await page.click('#btnLock'); await new Promise(r=>setTimeout(r,300));
ok(!(await page.$eval('#lockLine',e=>e.hidden)),'각도 고정 표시');
await page.click('#btnLock');
await page.click('#btnSaveAngle'); await new Promise(r=>setTimeout(r,500));
ok((await page.$eval('#toast',e=>e.textContent)).includes('저장했습니다'),'각도 기록 저장');
// 센서 중단 감지: 오버라이드 해제 후 이벤트 끊김
cur=null; await client.send('DeviceOrientation.clearDeviceOrientationOverride');
await new Promise(r=>setTimeout(r,3600));
st=await page.$eval('#levelState',e=>e.textContent); console.log('  센서 해제 후 상태:',st);

// 판정 기준 변경
await page.goto(B+'index.html#/settings'); await new Promise(r=>setTimeout(r,500));
await page.$eval('#setT1',e=>{e.value='0.2';e.dispatchEvent(new Event('change'));});
await page.$eval('#setUnit',e=>{e.value='mm';e.dispatchEvent(new Event('change'));});
await page.screenshot({path:'shots/06_settings.png',fullPage:true});
await setOri(0,0.4);
await page.goto(B+'index.html#/level'); await new Promise(r=>setTimeout(r,2000));
st=await page.$eval('#levelState',e=>e.textContent); ok(st.includes('거의 수평'),'기준 0.2°로 변경 → 0.4°는 거의 수평: '+st);

// 길이 측정 화면 (이 헤드리스 환경은 WebXR AR 미지원 → 안내 확인)
await page.goto(B+'index.html#/measure'); await new Promise(r=>setTimeout(r,1000));
const arst=await page.$eval('#arSupportStatus',e=>e.textContent); const dis=await page.$eval('#btnStartAR',e=>e.disabled);
ok(dis,'AR 미지원 환경에서 시작 버튼 비활성 + 안내: '+arst);
await page.screenshot({path:'shots/07_measure_unsupported.png'});

// 길이 기록을 DB에 직접 넣어 기록/CSV 경로 검증 (테스트 데이터, 앱 UI에는 '테스트' 메모로 구분)
await page.evaluate(async()=>{const db=await import('./js/db.js'); await db.addRecord({type:'length',unit:'cm',totalM:0.3456,value:0.3456,segments:[{chain:0,lengthM:0.3456,a:{x:0,y:0,z:0},b:{x:0.3456,y:0,z:0}}],note:'E2E 테스트 데이터',meta:{platform:'web'}});});
await page.goto(B+'index.html#/history'); await new Promise(r=>setTimeout(r,800));
const items=await page.$$eval('.record .value',els=>els.map(e=>e.textContent)); ok(items.length===2,'기록 목록 2건: '+items.join(', '));
await page.screenshot({path:'shots/08_history.png'});
// 앱 재시작(새 페이지) 후 기록 유지
const p2=await browser.newPage(); await p2.goto(B+'index.html#/history'); await new Promise(r=>setTimeout(r,800));
ok((await p2.$$('.record')).length===2,'페이지 재시작 후 기록 유지'); await p2.close();
// CSV
await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:'./dl'}).catch(()=>{});
await page._client?.().send?.('Page.setDownloadBehavior',{behavior:'allow',downloadPath:'./dl'}).catch?.(()=>{});
const csv=await page.evaluate(async()=>{const db=await import('./js/db.js'); const c=await import('./js/csv.js'); return c.recordsToCsv(await db.getAllRecords(),1);});
ok(csv.charCodeAt(0)===0xFEFF,'CSV UTF-8 BOM 포함'); console.log(csv.slice(1));
ok(csv.includes('길이')&&csv.includes('34.6')&&csv.includes('각도'),'CSV에 날짜·종류·값·단위 포함');
// 상세
const firstId=await page.evaluate(async()=>{const db=await import('./js/db.js'); return (await db.getAllRecords())[0].id;});
await page.goto(B+'index.html#/record/'+firstId); await new Promise(r=>setTimeout(r,600));
await page.screenshot({path:'shots/09_detail.png',fullPage:true});
ok((await page.$eval('#recordDetail',e=>e.innerText)).includes('측정 종류'),'기록 상세 표시');
// 개별 삭제 → 전체 삭제
await page.goto(B+'index.html#/history'); await new Promise(r=>setTimeout(r,600));
await page.click('.record .del'); await new Promise(r=>setTimeout(r,300)); await page.click('#modalBtns .btn.danger'); await new Promise(r=>setTimeout(r,600));
ok((await page.$$('.record')).length===1,'개별 삭제');
await page.click('#btnDeleteAll'); await new Promise(r=>setTimeout(r,300)); await page.click('#modalBtns .btn.danger'); await new Promise(r=>setTimeout(r,600));
ok((await page.$$('.record')).length===0,'전체 삭제');

// 오프라인: 서비스워커 캐시 후 네트워크 차단 → 재로드
await page.goto(B+'index.html#/home'); await new Promise(r=>setTimeout(r,1500));
await page.reload({waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,800));
await page.setOfflineMode(true);
await page.goto(B+'index.html#/level',{waitUntil:'domcontentloaded'}).catch(e=>console.log('  offline nav err',e.message));
await new Promise(r=>setTimeout(r,1500));
ok(await page.$eval('[data-view=level]',e=>e.classList.contains('active')).catch(()=>false),'오프라인 상태에서 앱 로드 및 수평기 화면');
ok(!(await page.$eval('#offlineBadge',e=>e.hidden).catch(()=>true)),'오프라인 배지 표시');
await page.setOfflineMode(false);
// 다크/라이트
await page.goto(B+'index.html#/settings'); await new Promise(r=>setTimeout(r,400));
await page.$eval('#setTheme',e=>{e.value='light';e.dispatchEvent(new Event('change'));}); await page.goto(B+'index.html#/home'); await new Promise(r=>setTimeout(r,400));
await page.screenshot({path:'shots/10_home_light.png'});
await page.evaluate(()=>localStorage.clear());
// 작은 화면
await page.setViewport({width:320,height:568,isMobile:true,hasTouch:true,deviceScaleFactor:2});
await page.goto(B+'index.html#/level'); await new Promise(r=>setTimeout(r,800));
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth); ok(!overflow,'320px 소형 화면 가로 넘침 없음');
await page.screenshot({path:'shots/11_small_level.png',fullPage:true});
// AR 모듈 로드 확인
const arLoad=await page.evaluate(async()=>{try{const m=await import('./js/ar.js'); return typeof m.ARMeasure==='function';}catch(e){return e.message;}});
ok(arLoad===true,'AR 모듈 + three.js 로드: '+arLoad);
ok(errors.length===0,'콘솔 오류 없음 '+JSON.stringify(errors));
clearInterval(streamer); await browser.close(); process.exit(fails?1:0);
