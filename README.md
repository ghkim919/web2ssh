# web2ssh

웹 브라우저에서 SSH 접속을 할 수 있는 터미널 클라이언트.

로컬에서 데몬을 실행하고 브라우저로 접속하면 PuTTY나 SecureCRT 없이 SSH 연결 가능.

## 실행

```bash
./web2ssh
```

http://localhost:8080 접속

### 포트 변경

```bash
./web2ssh -port 3000
```

## 빌드

```bash
go build -o web2ssh
```

## 추가 예정 기능

- [ ] SSH 키 인증 지원
- [ ] 연결 정보 저장 (세션 매니저)
- [ ] 멀티 탭 지원
- [ ] 파일 전송 (SFTP)
