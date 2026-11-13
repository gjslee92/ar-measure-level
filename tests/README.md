# 자동 테스트

| 파일 | 내용 | 실행 |
|---|---|---|
| `levelmath.test.mjs` | 수평기 각도 계산 단위 테스트 16개 | `node tests/levelmath.test.mjs` |
| `e2e.mjs` | 웹앱 전체 화면 E2E 29개 (센서 시뮬레이션, 기록, CSV, 오프라인 등) | `cd webapp && python3 -m http.server 8765` 후 `node tests/e2e.mjs` |
| `ar.mjs` | WebXR 에뮬레이터(IWER)로 AR 측정 흐름 14개 | `tests/make-ar-harness.sh` → `cd tests/site && python3 -m http.server 8766` → `node tests/ar.mjs` |
| `../android/app/src/test/.../LevelMathTest.kt` | Android 각도 계산 JUnit | `cd android && ./gradlew testDebugUnitTest` |

필요: Node 18+, Chrome(경로는 `CHROME_PATH` 환경변수), Python 3. `npm i puppeteer-core@23` 먼저 실행.
