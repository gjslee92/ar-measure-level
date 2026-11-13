#!/usr/bin/env bash
# WebXR 에뮬레이터(IWER + SEM)를 주입한 테스트용 사이트를 tests/site 에 만든다 (배포물에는 포함되지 않음)
set -e
cd "$(dirname "$0")"
npm i --no-save puppeteer-core@23 iwer @iwer/sem >/dev/null
rm -rf site && mkdir -p site/_t
for f in css js vendor icons sw.js manifest.webmanifest; do ln -s "../../webapp/$f" "site/$f"; done
cp node_modules/iwer/build/iwer.js node_modules/@iwer/sem/build/iwer-sem.js node_modules/@iwer/sem/captures/office_small.json site/_t/
python3 - <<'PY'
s=open('../webapp/index.html',encoding='utf-8').read()
inj='''<script src="_t/iwer.js"></script><script src="_t/iwer-sem.js"></script>
<script>
  const cfg = Object.assign({}, IWER.metaQuest3, { supportedFeatures: IWER.metaQuest3.supportedFeatures.concat(['dom-overlay']) });
  window.xrDevice = new IWER.XRDevice(cfg);
  xrDevice.installRuntime({ forceInstall: true });
  xrDevice.installSEM(IWER_SEM.SyntheticEnvironmentModule);
  window.semReady = fetch('_t/office_small.json').then(r => r.json()).then(j => { xrDevice.sem.loadEnvironment(j); return true; });
</script>
<script type="module" src="js/app.js"></script>'''
s=s.replace('<script type="module" src="js/app.js"></script>',inj)
open('site/index.html','w',encoding='utf-8').write(s)
PY
echo "완료: (cd tests/site && python3 -m http.server 8766) 실행 후 node tests/ar.mjs"
