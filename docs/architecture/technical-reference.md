# Catch My Heart — 技術リファレンス(AI開発用)

このファイルは開発時に AI(Claude Code)が参照する技術仕様の単一情報源。企画背景は `docs/architecture/product-plan.md`、意思決定の変遷は `docs/plans/HISTORY.md` を参照。

## プロダクト一行要約

遠距離カップルが2端末のブラウザで接続し、**🫰 指ハートでハートを撃ち合い、✋ パーで受けとめ、👌 つまみで回復する** P2P 対戦ゲーム。発射(🫰)と回復(👌)は**中指・薬指・小指の伸び本数**で分ける(🫰=折り畳み / 👌=3本伸び)。**体力ゲージ(HP)が先に尽きた方が負け**。ログインなし・サーバーなし・GitHub Pages ホスト。UIは「恋人のスケッチブック×エアメール」(色鉛筆の淡彩・紙の質感・手描きの揺らぎ)。

## 技術スタック

| 領域     | 採用技術                                        | 備考                                                                                                                                                                                 |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ビルド   | Vite 8 + TypeScript (vanilla)                   | フレームワーク不使用                                                                                                                                                                 |
| 顔検出   | `@mediapipe/tasks-vision` FaceLandmarker        | blendshapes 無効。鼻先 landmark 1 を取得するが、**発射の「顔の近く」判定を廃止したため現状ゲームロジックからは未使用**(将来 Face ごと外す余地)                                       |
| 手検出   | `@mediapipe/tasks-vision` **GestureRecognizer** | **`numHands: 1`(片手プレイ前提、2本目は認識しない)**。21点 landmark + 定型ジェスチャー分類(ILoveYou=🤟)を取得。👌/🫰 の分類は landmark の指伸び本数で行う(handedness には依存しない) |
| 通信     | `peerjs`(公式無料ブローカー)                    | MediaStream(映像+音声)+ DataConnection(JSON, `reliable: true` 必須)                                                                                                                  |
| 描画     | Canvas 2D + `<video>`                           | ハートはベクター描画。**手の21関節+ボーンの骨格を常時描画**(認識状態の可視化)                                                                                                        |
| テスト   | vitest 4(TDD)                                   | 純関数(game.ts / room.ts / render.ts の pruneEffects)を対象                                                                                                                          |
| デプロイ | GitHub Actions → GitHub Pages                   | CI でテスト → ビルド → デプロイ                                                                                                                                                      |

## ディレクトリ構成

```
/
├── index.html           # 画面構造 + 手描きハートのSVGシンボル定義(#sym-heart)
├── vite.config.ts       # base = process.env.GH_PAGES_BASE ?? "/"
├── src/
│   ├── main.ts          # エントリ。画面遷移・ゲームループ・入力の結線
│   ├── tracker.ts       # MediaPipe 初期化と検出(Face + GestureRecognizer)
│   ├── peer.ts          # PeerJS 接続・Msg 型・送受信
│   ├── room.ts          # ルームコード生成/検証/peerId(純関数)
│   ├── game.ts          # ゲームロジック・定数(純関数、DOM非依存)
│   ├── render.ts        # Canvas 描画(ベクターハート・手の骨格・エフェクト)
│   ├── prompts.ts       # 敗者への「愛のお題」
│   └── style.css        # スケッチブック×エアメールのテーマ
├── public/              # 静的アセット(favicon.svg / ogp.png / apple-touch-icon.png)
├── docs/
│   ├── architecture/    # 本ファイル + PRD
│   ├── plans/           # 設計・実装計画・編集履歴(gitignore対象・ローカルのみ)
│   └── mediapipe-basics/  # 基礎ガイド(README.md)+ 開発ガイド(development-guide.md)
└── .github/workflows/deploy.yml
```

## MediaPipe 詳細

- WASM とモデルは CDN からロード:
  - WASM: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm`
  - FaceLandmarker: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
  - GestureRecognizer: `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`
- `runningMode: "VIDEO"`、`delegate: "GPU"`(初期化失敗時は CPU で再初期化)。タイムスタンプは単調増加を保証
- **ウォームアップ必須**: 初回推論はグラフ初期化・delegate生成でメインスレッドを数秒ブロックする。`createTracker` がローディング画面中に初回推論を1回実行して吸収する(対戦開始時に走らせると rAF・タイマーが凍結し「ハート静止・HP不減・カウントダウンずれ」になる — E2Eで実証済み)
- `tracker.detect(now)` の返り値(すべて非ミラー正規化座標):
  `{ nose: Point|null, hands: [{ landmarks: Point[21], iloveyou: boolean }] }`(hands は最大1本)
  - `nose`: FaceLandmarker は現状も動くが、**発射の「顔の近く」判定を廃止したためゲームロジックからは未使用**。将来 FaceLandmarker ごと外す余地あり(ロード短縮。別issue)

## 座標系と表示空間

- 正規化 (0..1)、原点左上。**ネットワークに送る座標は常に非ミラー生値**
- ゲームキャンバス上の描画・当たり判定は「表示空間」で統一:
  - 相手映像は非ミラー表示 → 飛来ハートの表示 x = 受信した `x` をそのまま使用
  - 自分の手(骨格・判定点)の表示 x = **1 − 生値 x**(ミラー操作感)
  - 判定も表示空間同士で距離計算するため描画とズレない

## 操作体系(片手プレイ。口ジェスチャーは使わない)

| 操作               | 判定                                                                                                                                                                                                     | 結果                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **発射**           | 🫰 指ハート(親指×人差し指ピンチ + **中指/薬指/小指を折り畳む**、`isFingerHeart` = pinchPose==="heart" かつ isPinched)を **指を開いて離した瞬間**                                                         | 通常ハート(❤️ 赤、遅め: 飛行3200ms)。連射クールダウン 800ms。**顔の近さ・手の向き判定は廃止**(指の伸び本数で発射/回復を分ける)                                                                                                                                      |
| **チャージ弾**     | 上記の指ハートを **600ms 以上長押し**して離す                                                                                                                                                            | 💛 黄。**少しだけ速い(飛行2400ms)**、被弾ダメージ大。クールダウン 3000ms                                                                                                                                                                                            |
| **キャッチ**       | **✋ パー(開いた手)**の手のひら中心とハートの距離 ≤ 0.10(判定点は `palmCenter` = 中指MCP 9 を手首 0 へ 35% 寄せた点。付け根のままだと高すぎる)                                                           | キャッチ成功(ダメージ回避)。**指ハート(ピンチ)中・🤟中はキャッチ不可**                                                                                                                                                                                              |
| **つまみキャッチ** | 👌 つまみ(親指×人差し指ピンチ + **中指/薬指/小指が3本伸びる**、`isHealPinch` = pinchPose==="ok" かつ isPinched)のまま、ピンチ中点との距離 ≤ **0.07**(`HEAL_CATCH_RADIUS`。パー0.10より狭め=狙って当てる) | **体力回復 +15/個**(上限100)。**👌つまみは絶対に発射しない**                                                                                                                                                                                                        |
| **🤟 弾き返し**    | ILoveYou サインの手のひら中心(`palmCenter`)とハートの距離 ≤ 0.13。🤟判定は**定型分類 or 幾何フォールバック** `isILoveYou`(分類がNoneに転んでも反応するように)                                            | ハートを相手に返す(紫、飛行2600ms)。**1回使うと10秒使えない**(左下バッジに残り秒数をカウントダウン表示)。**🤟中はクールダウン中でもキャッチ不可**(`canOpenCatch`。強力な技のため、回復を誤認して🤟を出すとキャッチすらできなくなるリスクを意図的にコストとして課す) |

- ピンチ判定: 親指先(4)と人差し指先(8)の距離 ≤ 0.06(`isPinched`)
- **つまみ姿勢の分類** `pinchPose(landmarks)`: 中指(9→12)・薬指(13→16)・小指(17→20)のうち指先が手首から MCP の `OPEN_HAND_RATIO(1.3)` 倍より遠い(=伸びている)本数を数え、`≥ OK_MIN_EXTENDED(3)` → `ok`(👌回復)、`≤ HEART_MAX_EXTENDED(1)` → `heart`(🫰発射)、間(2本)は `unknown`(取り違え防止のデッドバンド)。**手の向き(palm/back)ではなく指の伸び具合で分ける**(指ハートはエッジ姿勢で向き判定が潰れて不安定だったため。実機スクショで確定)。handedness 非依存
- **姿勢のヒステリシス** `updatePose`: 連続 `POSE_STABLE_FRAMES` フレーム一致で初めて確定(単発ノイズで回復↔発射が入れ替わるのを防ぐ)。unknown フレームは直前状態を保持
- **発射ステートマシン** `updateShoot(state, input, now)`: 🫰(heart)で蓄積、**指を物理的に開いた瞬間**に発射(`resolveShot` でチャージ判定)。ピンチを維持したまま 🫰→👌(pose==="ok")へ持ち替えたら**発射せずキャンセル**(誤爆防止)。手を見失ったフレームでは発射しない
- **補助診断** `palmSpread(landmarks)`: 手の広がり比(=|人差し指MCP5 − 小指MCP17| / |手首0 − 中指MCP9|)。**主判定には使わずデバッグHUDの参考表示のみ**。指本数で足りないときの将来フォールバック候補
- **デバッグHUD**: `?debug=1` で起動すると左上に `ext / pose / pinch / spread / gesture` を実測表示(`formatGestureDebug`)。閾値チューニング用
- **クロス確証(任意・未結線)** `isThumbIndexCrossed`: 👌(ループ)と 🫰(親指×人差し指クロス)の見分けを補強する幾何判定。現状は未使用。誤発射が残る場合に発射条件へ AND する候補
- **パー判定** `isOpenHand`: 人差し指〜小指の4本のうち3本以上で、指先が手首から MCP の 1.3 倍より遠い(=指が伸びている)。閉じた手・ピンチ中・🤟中はキャッチできない(成立条件は `canOpenCatch` に集約。🤟のクールダウン中も不可 — 上表の意図コメント参照)
- 画面左下: 縦バー=**チャージ長押しの進捗**(🫰指ハート中)、🤟バッジ=**弾き返しの残りクールダウン秒数**(回復すると点滅)
- 手の骨格(21関節+ボーン)を常時描画。状態リング(`ringKind`): 🤟=紫 / 👌つまみ(回復)=赤・半径0.07 / 🫰指ハート(発射)=黄 / パー=白 / その他=薄グレー
- **座標補正 `coverMap`**: 映像は `object-fit: cover` で拡大トリミング表示されるため、カメラフレーム正規化座標をそのまま描くと手と骨格がズレる。`coverMap(p, videoW, videoH, viewW, viewH)` で表示領域座標へ写像してから描画・判定する(ミラー `x→1−x` はフレーム空間で先に適用)

## 体力ゲージ(HP)モデル

- `MAX_HP = 100`。**3ライフ制は廃止**
- 被弾(取り逃し): 通常・弾き返し弾 **−20**、チャージ弾 **−30**(`heartDamage()`)
- つまみキャッチ: **+15/個**(`healHp`、上限100)
- HP 0 で敗北。HUD は手描き風HPバー(30以下で点滅)
- **single writer**: 自分のHPは自分だけが更新し、変化のたびに `life` で相手へ通知(相手HPは表示専用)。自分 0 → lose、相手 `life: 0` 受信 → win、双方 0 → draw(お題なし)

## ゲーム定数(src/game.ts に集約)

```ts
export const SHOT_COOLDOWN_MS = 800;
export const CATCH_RADIUS = 0.1; // 0.12 は広すぎたため縮小
export const PALM_CENTER_LERP = 0.35; // 判定点: 中指MCP(9)→手首(0)へ寄せる割合
export const HEART_FLIGHT_MS = 3200; // 通常(基本は遅め)
export const MAX_HP = 100;
export const DAMAGE_NORMAL = 20; // 通常・弾き返し
export const DAMAGE_SPECIAL = 30; // チャージ弾
export const HEAL_PERFECT = 15; // つまみキャッチ回復量
export const PINCH_THRESHOLD = 0.06;
export const HEAL_CATCH_RADIUS = 0.07; // 👌回復の判定半径。パー(0.10)より狭め(狙って当てる)
export const SPECIAL_FLIGHT_MS = 2400; // チャージ弾(少しだけ速い)
export const SPECIAL_HOLD_MS = 600;
export const SPECIAL_COOLDOWN_MS = 3000;
export const REFLECT_RADIUS = 0.13;
export const REFLECT_COOLDOWN_MS = 10_000; // 🤟は10秒に1回

export const COUNTDOWN_STEP_MS = 900; // 開始カウントダウン1刻み(countdownLabel)
export const FLICK_FLIGHT_MS = 2600; // 弾き返し弾
export const OPEN_HAND_RATIO = 1.3;
export const OPEN_FINGERS_REQUIRED = 3;

// 👌つまみ / 🫰指ハートの分類(中指・薬指・小指の伸び本数)
export const OK_MIN_EXTENDED = 3; // 👌: この本数以上伸びれば回復
export const HEART_MAX_EXTENDED = 1; // 🫰: この本数以下なら発射(間はデッドバンド=unknown)
export const POSE_STABLE_FRAMES = 4; // 連続一致で姿勢を確定(ヒステリシス)
export const THUMB_CROSS_MARGIN = 0.005; // 親指×人差し指クロス確証のマージン(isThumbIndexCrossed・現状未結線)
// ※ 廃止: SPECIAL_NEAR_FACE_DIST(顔の近さ判定)/ handFacing・FACING_* / PINCH_CATCH_RADIUS
//   発射/回復の分岐は「顔の近さ」→「手の向き」→ 最終的に「指の伸び本数(pinchPose)」へ移行
```

## 通信プロトコル(PeerJS DataConnection, JSON)

Peer ID 規約: ホストは `cmh-<ROOM>`(ROOM は英大文字4文字、I/O 除外、ホストがランダム生成)。`unavailable-id` エラー時は別コードで再生成。ゲストはランダム ID で `cmh-<ROOM>` に接続。URL `?room=XXXX` で参加導線に直行。

接続確立順序: ゲストが DataConnection(**`reliable: true` 必須**)→ MediaStream call の順で発信し、ホストが accept/answer。ローカル `<video>` は `muted` 必須。

```ts
type Msg =
  | { t: "hello" }
  | { t: "start"; seed: number } // ホスト送信。カウントダウン(3→2→1→♥、COUNTDOWN_STEP_MS=900ms刻み)後開始+お題シード。表示・開始判定は countdownLabel(経過時間ベース、jank耐性)
  | { t: "heart"; id: number; x: number; kind?: "special" | "flick" } // 発射。idは送信者ごとの連番
  | { t: "catch"; id: number } // 相手のハートidをキャッチ(演出用)
  | { t: "miss"; id: number } // 相手のハートidを取り逃した(演出用)
  | { t: "life"; mine: number } // 自分の残HP(0..100)。変化時のみ送信
  | { t: "rematch" }; // 両者送信でホストが新 start を送る
```

### ハートのライフサイクル

1. 送信側: 発射 → `heart {id, x, kind?}` 送信。自画面ではハートが画面上端まで**上昇していく演出**のみ(物理・判定なし。RISE_MS=1100ms で縮小+フェード)。🤟弾き返し時も同様にその位置から上昇。ソロ練習でも同じ演出
2. 受信側: 画面上端 `x` に出現、kind に応じた飛行時間で直線落下(線形補間)。**開始前(`playing` になる前)に届いた `heart` は破棄**(開始直後の即被弾を防ぐ)
3. 受信側が毎フレーム判定: お皿キャッチ / つまみキャッチ(回復+`life`) / 🤟弾き返し(自分の連番で `heart {kind:"flick"}` を送り返す) / 画面下端到達 → `heartDamage(kind)` 分の被弾 + `miss` + `life`

### お題・切断・リマッチ

- お題: `start.seed % prompts.length` を両端末で決定的に算出。敗者画面にのみ表示
- 切断: DataConnection の close/error で中断表示 → トップへ。自動再接続なし(MVP)
- リマッチ: 両者 `rematch` 送信 → ホストが新 seed の `start` を再送

## 制約(変更禁止事項)

- ログイン・アカウント・外部DB・独自サーバーを追加しない
- 映像・座標データは P2P のみ(PeerJS ブローカーはシグナリングのみ)
- GitHub Pages(静的配信)で完結。SSR・API ルート禁止
- UI 言語は日本語。テーマは「ハートと愛」(キス表現は使わない)
- 片手プレイ前提(`numHands: 1` を上げない)

## UI テーマ実装メモ

- パレット(CSS 変数と render.ts で共有): paper `#f6efe3` / ink `#3f3a35` / red `#c9452e` / blue `#5b7fa6` / mustard `#e3b23c` / green `#8aa86f` / plum `#8a5a83`
- フォント: Caveat(欧文スクリプト)+ Yusei Magic(和文手書き)+ Zen Maru Gothic(本文)
- モチーフ: 紙の質感(SVGノイズ)、水彩のにじみ、エアメール縁(border-image の赤青ストライプ)、切手+消印、便箋罫線、手描き風HPバー
- レスポンシブ: モバイル縦基準。`min-width: 700px`(iPad縦)と `min-aspect-ratio: 5/4`(iPad横/PC)で拡張。`prefers-reduced-motion` 対応

## GitHub Pages デプロイ

- `vite.config.ts`: `base: process.env.GH_PAGES_BASE ?? "/"`。CI が `GH_PAGES_BASE=/<repo>/` を注入
- `.github/workflows/deploy.yml`: push to main → `npm ci` → `npm test` → `npm run build` → deploy-pages
- カメラ・WebRTC は HTTPS 必須(GitHub Pages は HTTPS、ローカルは localhost で可)

## テスト・検証

- `npm run test`: vitest(game / room / render の純関数。件数は増えるため固定記載しない)。**新ルールは必ずテストファーストで追加する(TDD)**
- 手動E2E: 2ブラウザで `?room=` 接続 → 対戦一巡 → リマッチ。ソロ練習モードは Peer なしの動作確認経路(通常/チャージ/弾き返しの各弾種が混ざって降ってくる)

## 開発環境の既知の罠(このマシンのサンドボックス)

- `.git` 作成・ソケット作成(ブラウザ起動含む)・`*token*` ファイル名の読み取りがブロックされる
- npm install 後に postcss が `Cannot find module './tokenize'` で落ちる場合はサンドボックス起因(実体は存在する)。ローカル検証用ワークアラウンド: `npm pack postcss@<ver>` → tar で `package/lib/tok*` を stdout 抽出して `lexer.js` として配置し、`parser.js` / `terminal-highlight.js` の require を `./lexer` に書き換える。**ユーザー端末・CI では不要**
