# ❤️ Catch My Heart

遠距離カップルのための対戦ミニゲーム。ビデオ通話しながら**指ハートでハートを撃ち合い、✋ パーの手で受けとめる**。受けとめきれないと体力ゲージが減り、先に尽きた方が負け。負けた人には「愛のお題」が出ます。

- 🙅 ログイン不要・インストール不要・サーバー不要(完全静的 + P2P)
- 📱 スマホ・iPad 対応(レスポンシブ)
- 🔒 映像とジェスチャーの解析はすべて端末内(MediaPipe)。映像がサーバーに送られることはありません
- 🎨 UIは「恋人のスケッチブック×エアメール」— 色鉛筆の淡彩と手描きのゆらぎ

## 遊び方

1. 一人が「ルームを作る」→ 招待リンクをコピーして LINE などで送る
2. 相手がリンクを開いて「参加する」を押すと接続、3秒カウントダウンで開始(片手で遊べます)
3. ❤️ **顔の横で指ハート(親指と人差し指でピンチ)→ 離すと発射**(弾はゆっくり飛ぶ)
4. 💛 指ハートを**長押し(0.6秒)してから離すとチャージ弾**(少し速い&ダメージ大)
5. ✋ 飛んでくるハートは**パーの手でキャッチ**(手を開いていないと取れない。指ハートで発射準備中も取れない)
6. 💚 **つまんでキャッチすると体力回復**(+15)
7. 🤟 **I love you サインで弾き返し**(触れたハートが相手に戻る。1回使うと10秒間は使えず、画面左下にカウントダウンが出る)
8. 取り逃すと体力ダメージ(通常20/チャージ弾30)。**体力ゲージが先に尽きた方が負け!**

一人で試したいときは「ひとりで練習」へ。

## 開発

```bash
npm install
npm run dev    # http://localhost:5173
npm run test   # ゲームロジックのユニットテスト (vitest)
npm run build  # 型チェック + プロダクションビルド
```

技術スタック: Vite + TypeScript / MediaPipe Tasks Vision (FaceLandmarker + GestureRecognizer) / PeerJS (WebRTC)

設計ドキュメント: [docs/architecture/](docs/architecture/) / MediaPipe 入門: [docs/mediapipe-basics/](docs/mediapipe-basics/)

## GitHub Pages へのデプロイ

1. GitHub にリポジトリを作成して push
2. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定
3. main ブランチへ push すると `.github/workflows/deploy.yml` が自動でビルド&デプロイ

公開 URL は `https://<ユーザー名>.github.io/<リポジトリ名>/` になります(ビルド時に `GH_PAGES_BASE` が自動設定されます)。

## 制限事項

- P2P 接続(PeerJS の無料シグナリングサーバー)を使うため、企業ネットワークなど一部の NAT 環境では接続できないことがあります
- カメラ利用のため HTTPS(または localhost)でのみ動作します
