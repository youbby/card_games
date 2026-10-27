# Card Games

혼자서 CPU와 대전하는 안드로이드 카드 게임. 첫 게임은 텍사스 홀덤(No-Limit, 2~6인).
게임용 가상 칩만 사용하며 실제 돈과는 관련이 없습니다.

기획·설계 문서는 [docs/](docs/README.md)에 있습니다.

## 개발

```bash
npm install
npm run dev          # 브라우저에서 http://localhost:5173 (개발자 도구의 모바일 화면으로 보기)
npm test             # 엔진·족보·사이드팟·저장소 테스트
npm run typecheck
npm run simulate     # CPU끼리 대전 (High vs Low 등), 칩 보존 검사
```

## 안드로이드 APK 빌드

필요: Android Studio(내장 JDK 사용), Android SDK

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npm run android:apk
# 결과: android/app/build/outputs/apk/debug/app-debug.apk
```

웹 코드를 바꾼 뒤에는 `npm run android:sync`로 `android/`에 반영합니다.

## 구조

```
src/
  core/            카드, 시드 RNG, 족보 평가
  games/holdem/    홀덤 엔진(규칙·사이드팟), 블라인드 단계, CPU AI(Low/High)
  data/            IndexedDB(Dexie) 스키마와 타입
  services/        캐릭터, CPU 풀, 세션(바이인·기록·정산·파산), 테이블 진행, 초기화
  screens/, ui/    화면과 공통 컴포넌트
  app/             라우팅, 시작 흐름, 네이티브 연동(뒤로가기·진동), 효과음
tools/simulate.ts  헤드리스 봇 대전
```
