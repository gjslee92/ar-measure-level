import * as M from '../webapp/js/levelmath.js';
const close=(a,b,t=0.05)=>Math.abs(a-b)<t; let fails=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fails++;};
let u=M.upFromOrientation(0,0); let f=M.flatAngles(u); ok(close(f.x,0)&&close(f.y,0)&&close(f.total,0),'평면 0°');
u=M.upFromOrientation(0,5); f=M.flatAngles(u); ok(close(f.x,5)&&close(f.y,0),'gamma 5° → 좌우 5° (오른쪽 낮음) '+f.x.toFixed(3));
u=M.upFromOrientation(0,-10); f=M.flatAngles(u); ok(close(f.x,-10),'gamma -10° → 좌우 -10° '+f.x.toFixed(3));
u=M.upFromOrientation(5,0); f=M.flatAngles(u); ok(close(f.y,5),'beta 5° → 전후 5° '+f.y.toFixed(3));
u=M.upFromOrientation(90,0); let e=M.edgeAngles(u); ok(close(e.rot,0)&&e.orientation==='vertical'&&close(e.dev,0),'세로로 세움 → 수직 0°');
// 세로 세운 상태에서 시계방향 3° 회전: 위쪽이 오른쪽으로 → gamma? 직접 up 벡터로
const rot=(deg)=>{const r=deg*Math.PI/180; return [-Math.sin(r),Math.cos(r),0];};
e=M.edgeAngles(rot(3)); ok(close(e.dev,3)&&e.orientation==='vertical','시계 3° → 수직오차 +3 '+e.dev.toFixed(3));
e=M.edgeAngles(rot(90)); ok(close(e.rot,90)&&e.orientation==='horizontal'&&close(e.dev,0),'가로(시계 90°) → 수평 0°');
e=M.edgeAngles(rot(275)); ok(close(e.rot,275)&&e.orientation==='horizontal'&&close(e.dev,5),'275° → 수평 +5° '+e.dev.toFixed(3));
e=M.edgeAngles(rot(178)); ok(close(e.dev,-2)&&e.orientation==='vertical','178° → 수직 -2°');
e=M.edgeAngles(rot(359.6)); ok(close(e.rot,359.6)&&close(e.dev,-0.4),'359.6° 래핑 '+e.dev.toFixed(3));
// beta≈90 근처 짐벌락에서 연속성
const a=M.edgeAngles(M.upFromOrientation(89.9,30)), b=M.edgeAngles(M.upFromOrientation(90,0)); ok(close(a.rot,b.rot,0.2),'짐벌락 부근 연속 '+a.rot.toFixed(3));
// 가로 세움: beta=0,gamma=-90 (왼쪽 모서리가 아래?) 
e=M.edgeAngles(M.upFromOrientation(0,-89.99)); ok(e.orientation==='horizontal','beta0 gamma-90 → 가로 '+e.rot.toFixed(2));
// 2단계 보정 원리: 바이어스 b, 실제 t → r1=t+b, r2=-t+b
const t=0.8,bias=0.3; ok(close(((t+bias)+(-t+bias))/2,bias,1e-9),'2단계 보정 바이어스 산출');
ok(M.judge(0.5,0.5,1)==='ok'&&M.judge(0.51,0.5,1)==='near'&&M.judge(1.01,0.5,1)==='bad','판정 기준 경계(0.5/1.0)');
ok(M.pickMode([0,0,1])==='flat'&&M.pickMode([0,1,0])==='edge'&&M.pickMode([0,0.6,0.8],'edge')==='flat'&&M.pickMode([0,0.7,0.71],'flat')==='flat','자동 모드 히스테리시스');
const sc=M.toScreenFrame([1,0,0],90); ok(close(sc[0],0,1e-9)&&close(sc[1],1,1e-9),'화면 회전 변환');
process.exit(fails?1:0);
