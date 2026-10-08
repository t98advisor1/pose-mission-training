# 포즈 미션 · Gemini와 Google Sheets

Gemini에서 실제 생성한 HTML과 수정 응답을 조립한 교원연수용 앱입니다. 승인한 AI 생성 사진 7종과 MediaPipe PoseLandmarker·GestureRecognizer로 자세를 확인하고, 연속 2초 성공 시 미션마다 한 번 100점(최대 700점)을 줍니다. 성공 결과는 Google Apps Script를 거쳐 Google Sheets에 저장하며, 해당 미션의 저장 영수증을 확인한 뒤 완료로 표시합니다. 랭킹은 서버가 계산한 닉네임별 최고 점수를 읽습니다.

영상·사진·관절 좌표는 서버로 보내지 않습니다. 전송 항목은 도전ID·닉네임·미션 이름이며, 시트에는 미션별 점수·총점·갱신시각을 기록합니다. 저장 대기 결과는 브라우저에 보관해 재시도합니다. 시트 원본은 비공개이며 공개 점수 API는 닉네임·점수·완료 결과를 제공합니다. 본인 인증이 없는 연습용 랭킹이라 실제 이름 대신 서로 다른 별명을 사용합니다.

2026-10-09 기준 포즈·카메라의 합성/모킹 62검사, 서버 18검사, 저장 연결 23검사를 통과했습니다. **이 수치는 사람 인식률이 아닙니다.** 실제 Apps Script 배포, 시트 100→200점 저장, 같은 미션 재전송 시 행·점수·시각 불변, 두 가상 참가자의 랭킹 자동 반영을 확인했습니다. 저장 버튼에서 같은 시험 화면 랭킹까지 6.79·7.98·7.56초, 다른 탭에서 새 참가자 관찰까지 4.50초가 걸렸습니다. 같은 컴퓨터의 합성 결과 전송 시험이며 두 기기·사람의 자세 성공 시험은 아닙니다. 장치 카메라·사람 7포즈·모바일 성능·GitHub Pages는 후속 확인 중입니다.

## 업로드할 파일

GitHub 저장소의 첫 화면에서 다음 파일이 바로 보이도록 올립니다. `pose-mission-gemini` 폴더를 통째로 한 단계 더 감싸서 올리지 않습니다.

```text
index.html
sheets-sync.js
photos/
  big-v-v2.png
  heart-v2.png
  victory-v2.png
  thumb-up-v2.png
  flower-v2.png
  hero-v2.png
  dab-v2.png
.nojekyll
README.md
```

`index.html`은 웹페이지, `sheets-sync.js`는 저장 큐·영수증·랭킹 연결, `photos/`는 승인된 AI 생성 포즈 사진입니다. `.nojekyll`은 별도 Jekyll 처리를 건너뛰도록 두는 빈 파일입니다. **`preview-server.mjs`, `versions/`, `backend/`는 로컬 확인·원문·설치 이력용이므로 앱 공개 파일에 포함하지 않습니다.** 브라우저의 파일 업로드는 `.gitignore`만으로 제외되지 않으니 선택한 파일을 직접 확인합니다.

개인정보, 실제 참가 기록, Google Sheets 원본·내보내기 파일, OAuth 토큰·비밀키·`.env`는 올리지 않습니다. 시트 연결이 추가된 뒤에도 공개 파일에 비밀값을 넣지 않습니다.

## GitHub Pages로 직접 게시하기

1. GitHub에서 사용할 전용 저장소를 엽니다. 새 저장소가 필요하면 승인된 계정·공개 범위로 만듭니다. GitHub Free에서 Pages를 사용하려면 공개 저장소가 필요합니다. [GitHub 공식 생성 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
2. **Add file → Upload files**에서 위 파일을 올립니다. `photos/` 폴더 구조도 유지합니다. **Commit changes**로 저장한 뒤, `main` 브랜치 첫 화면에 `index.html`과 `photos/`가 있는지 확인합니다.
3. 저장소의 **Settings → Pages**를 엽니다. Settings가 안 보이면 해당 저장소를 관리할 권한부터 확인합니다.
4. **Build and deployment → Source**를 **Deploy from a branch**로 고릅니다.
5. **Branch: main**, **Folder: /(root)**를 선택하고 **Save**를 누릅니다. 이 설정 순서는 [GitHub 공식 게시 소스 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)를 따릅니다.
6. 게시 처리가 끝나면 Pages에 표시된 **Visit site**로 엽니다. 바로 보이지 않으면 **Actions**에서 게시 작업의 완료·오류를 확인합니다. 변경 반영에는 최대 약 10분이 걸릴 수 있습니다. [공식 확인 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
7. 실제 주소에서 시작하기·돌아가기와 포즈 안내를 확인합니다. 사진을 연결한 버전이라면 7개 사진도 확인합니다. 문장을 수정해 커밋한 뒤 게시 주소에 반영되는지도 봅니다.

Pages는 정적 파일을 게시하고 저장 서버는 Apps Script에서 실행합니다. 개인 실습용으로 복사할 때는 자신의 결과 시트에 서버 코드를 설치·웹 앱 배포한 뒤 `sheets-sync.js` 상단의 `SHEETS_WEB_APP_URL`을 자신의 배포 주소로 바꿉니다. 서버는 11열의 헤더를 검사하며 기존 자료를 자동으로 덮어쓰거나 새 탭을 만들지 않습니다. 성공 흐름은 **미션 성공 → Sheets 점수 갱신 → 앱 안 저장 영수증 확인 → 참가자 랭킹 자동 조회**입니다. 랭킹은 한 번의 요청이 끝난 뒤 약 5초 후 다시 읽으므로 실제 반영 지연에는 통신·실행시간이 더해집니다.

## 아직 확인할 것

GitHub Pages 절차는 2026-10-08 공식 문서를 확인한 안내이며 실제 GitHub 업로드·Pages 배포는 아직 수행하지 않았습니다. 실제 계정 화면에서 메뉴·설정·게시 주소를 캡처해 대조하고, 404·사진 누락은 `main`/`(root)`와 파일 경로·대소문자를 확인합니다. 실제 사람의 인식률, 모바일 성능, 두 기기 동시 사용과 서버 결과 조작 방지는 검증된 것으로 소개하지 않습니다. 서버는 브라우저가 보내는 성공 결과를 수용하므로 경쟁·평가용 인증 시스템을 제공하지 않습니다.

교사와 학부모를 위한 바이브 코딩 All rights reserved
