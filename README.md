# Score Sync App

YouTube 또는 로컬 영상과 PDF 파트보를 함께 보면서 체크포인트를 기록하고,
재생 시간에 맞춰 악보를 자동 스크롤하는 브라우저 기반 연습 도구입니다.

## 주요 기능

- YouTube 및 로컬 영상 재생
- PDF 악보 표시와 부드러운 자동 스크롤
- 재생 중 체크포인트 추가·삭제
- 프로젝트별 브라우저 자동 저장
- 동기화 기록 JSON 저장·불러오기
- 태블릿 친화적 반응형 화면

PDF와 동기화 데이터는 서버에 업로드되지 않고 사용자의 브라우저에서 처리됩니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 검사

```bash
npm run lint
npm run build
```

## Cloudflare Pages

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Node.js: `22`

GitHub 저장소를 Cloudflare Pages에 연결하면 `main` 브랜치가 갱신될 때마다 자동 배포할 수 있습니다.

## 공개 저장소 주의사항

테스트용 악보와 로컬 렌더 결과는 `.gitignore`로 제외됩니다. 저작권이 확인되지 않은
악보 PDF나 영상 파일은 저장소에 커밋하지 마세요.
