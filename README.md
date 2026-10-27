# Card Games

혼자서 CPU와 대전하는 안드로이드 카드 게임. 첫 게임은 텍사스 홀덤(No-Limit, 2~6인).
게임용 가상 칩만 사용하며 실제 돈과는 관련이 없습니다.

## 설치

[GitHub Releases](https://github.com/youbby/card_games/releases)에서 최신 `card-games-버전.apk`를 내려받아 설치합니다. Android 7.0 이상을 지원합니다.

기존 디버그 APK와 릴리스 APK는 서명이 다릅니다. 디버그 앱을 삭제한 뒤 릴리스 앱을 설치해야 하며, 삭제 시 기기에 저장된 캐릭터와 전적도 지워집니다.

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

## 서명된 릴리스 APK (Windows)

```powershell
# 최초 한 번: 프로젝트 전용 서명키 생성
npm run android:release -- -InitializeSigning

# 이후에는 같은 키로 빌드
npm run android:release
# 결과: release/card-games-0.1.0.apk 및 .apk.sha256
```

스크립트는 웹 빌드·Android 동기화·릴리스 빌드 후 APK 정렬, 서명, 서명 검증과 SHA-256 체크섬 생성을 수행합니다. JDK는 `JAVA_HOME`, SDK는 `ANDROID_HOME` 또는 `android/local.properties`에서 찾습니다.

서명키는 기본적으로 `%USERPROFILE%/.android/card-games-release.jks`에 저장됩니다. 암호는 현재 Windows 계정으로 암호화해 `.signing/release.clixml`에 보관하며, 두 파일 모두 Git에 포함하지 않습니다. 업데이트에는 같은 키가 필요하므로 키와 복구 가능한 암호를 별도로 백업하세요. 암호화된 설정은 다른 PC·Windows 계정에서 그대로 사용할 수 없습니다.

앱 버전을 올릴 때는 `package.json`·`package-lock.json`의 버전과 `android/app/build.gradle`의 `versionName`을 맞추고, `versionCode`를 증가시킵니다.

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
