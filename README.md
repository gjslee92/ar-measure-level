# AR 측정 · 수평기 (Android APK + 모바일 웹앱)

스마트폰 하나로 **AR 길이 측정**과 **디지털 수평기(수평·수직·각도)** 를 사용하는 독립형 측정 앱입니다.
로그인·회원가입·서버·광고가 없으며, 측정 기록은 **기기 내부에만** 저장됩니다.

## 폴더 구성

```
├─ webapp/            모바일 웹앱 (바로 배포 가능한 완성본, 빌드 과정 없음)
├─ android/           Android 네이티브 앱 소스 (Kotlin + ARCore + Room)
├─ .github/workflows/ GitHub에 올리면 APK 자동 빌드 + 웹앱 자동 배포
├─ tests/             자동 테스트 스크립트
└─ docs/              설명서
   ├─ 01_빌드_및_설치_배포_방법.md   (빌드·실행, APK 설치, 웹앱 배포)
   ├─ 02_사용자_매뉴얼.md
   ├─ 03_주요_기능_설명서.md
   ├─ 04_테스트_결과_보고서.md
   └─ 05_제한사항_및_호환성.md
```

## 가장 빠른 시작

| 목적 | 방법 |
|---|---|
| 웹앱을 휴대폰에서 바로 쓰기 | `webapp` 폴더를 HTTPS 정적 호스팅(GitHub Pages, Netlify 등)에 올리고 휴대폰 Chrome으로 접속 → 자세한 내용 `docs/01` |
| APK 만들기 (PC에 Android Studio 있음) | Android Studio에서 `android` 폴더 열기 → Build › Build APK(s) |
| APK 만들기 (설치 없이) | 이 폴더 전체를 GitHub 저장소에 올리면 Actions가 APK를 만들어 줌 → Actions 탭 › 최신 실행 › Artifacts |

## 현재 상태 요약

- **웹앱**: 완성. 자동 테스트 59개 통과(수평기 계산, 화면 동작, 기록·CSV·오프라인, WebXR 에뮬레이터 AR 측정). 실제 스마트폰 테스트는 **미검증**.
- **Android**: 전체 소스 완성. 작업 환경에서 Google 저장소 접속이 막혀 **APK 빌드는 미검증**. 각도 계산 로직은 컴파일·테스트 통과, 나머지 Kotlin 파일은 문법 검사만 통과.
- 상세 내역은 `docs/04_테스트_결과_보고서.md`.
