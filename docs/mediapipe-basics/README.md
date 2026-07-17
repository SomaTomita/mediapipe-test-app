# MediaPipe 基礎ガイド

このプロジェクト(Catch My Heart)で使う MediaPipe の基礎知識と最小限の使い方をまとめたもの。

## MediaPipe とは

Google が公開している機械学習ソリューション群。顔・手・ポーズの検出、ジェスチャー認識、画像分類などの学習済みモデルを、**ブラウザ内(WASM + WebGL/GPU)で完結**して実行できる。

Web 向けは **MediaPipe Tasks Vision**(npm: `@mediapipe/tasks-vision`)というパッケージにまとまっている。

**重要な特徴:**

- サーバー不要。映像は端末外に一切送信されない(プライバシー面で有利)
- リアルタイム処理が可能(一般的な PC/スマホ/iPad で 30fps 前後)
- カメラ入力は標準の `getUserMedia` を使い、`<video>` 要素を渡すだけ

## 主なタスク(Vision 系)

| タスク                | できること                                    | 本プロジェクトでの用途                                                                           |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **FaceLandmarker**    | 顔の478点ランドマーク + 表情 blendshape(52種) | 鼻先(landmark 1)の位置のみ使用。「顔の近くで指ハートを作ったか」の判定基準(blendshapes は無効化) |
| **GestureRecognizer** | 手の21点ランドマーク + 定型ジェスチャー分類   | 主役。指先座標(ピンチ=発射/つまみキャッチ)、🫴お皿の手判定、🤟(ILoveYou)=弾き返し                |
| HandLandmarker        | 手の21点ランドマークのみ                      | 不使用(GestureRecognizer が landmark も返すため置き換えた)                                       |
| PoseLandmarker        | 全身33点の姿勢推定                            | 不使用                                                                                           |
| ImageSegmenter        | 人物切り抜き・背景分離                        | 不使用                                                                                           |

### GestureRecognizer が分類できる定型ジェスチャー

`None / Closed_Fist / Open_Palm / Pointing_Up / Thumb_Down / Thumb_Up / Victory / ILoveYou` の8種。本プロジェクトは **ILoveYou(🤟)** を弾き返しに使っている。

なお「🫴 お皿の手(手が開いているか)」は Open_Palm 分類に頼らず、**ランドマークの幾何判定**で行っている(手のひらがカメラに正対していなくても効くように)。手首(0)から各指先(8,12,16,20)までの距離が、対応する付け根 MCP(5,9,13,17)までの距離の 1.3 倍を超える指が 3 本以上あれば「開いている」(`src/game.ts` の `isOpenHand`)。

### 手の21点ランドマークの主要インデックス

| index              | 部位                | 本プロジェクトでの用途                                                           |
| ------------------ | ------------------- | -------------------------------------------------------------------------------- |
| 0                  | 手首                | お皿の手判定の基準点                                                             |
| 4                  | 親指の先            | ピンチ判定(8との距離 ≤ 0.06)                                                     |
| 8                  | 人差し指の先        | ピンチ判定 / お皿の手判定                                                        |
| 9                  | 中指の付け根        | 手のひら中心の基準点(手首0へ35%寄せた `palmCenter` がキャッチ・弾き返しの判定点) |
| 5,13,17 / 12,16,20 | 各指の付け根 / 先端 | お皿の手判定・骨格描画                                                           |

21点すべては骨格(ボーン+関節)として Canvas に常時描画している(`src/render.ts` の `drawSkeleton`)。

## 最小の使い方

### 1. インストール

```bash
npm install @mediapipe/tasks-vision
```

### 2. 初期化(WASM とモデルのロード)

```ts
import { FilesetResolver, FaceLandmarker, GestureRecognizer } from "@mediapipe/tasks-vision";

const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm");

const face = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    delegate: "GPU", // 失敗したら "CPU" で再試行
  },
  runningMode: "VIDEO", // 動画ストリーム用モード
  outputFaceBlendshapes: false, // 表情スコアが必要なら true
  numFaces: 1,
});

const gesture = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numHands: 1,
});
```

### 3. カメラ映像を流し込む検出ループ

```ts
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
video.srcObject = stream;
await video.play();

function loop() {
  const now = performance.now(); // VIDEO モードは単調増加のタイムスタンプ必須
  const faceResult = face.detectForVideo(video, now);
  const handResult = gesture.recognizeForVideo(video, now); // ※Gesture は recognizeForVideo

  // 例: 鼻先の位置(landmark 1)
  const nose = faceResult.faceLandmarks?.[0]?.[1]; // { x, y, z } 各0..1の正規化座標

  // 例: 指先とピンチ判定
  const hand = handResult.landmarks?.[0];
  const thumbTip = hand?.[4];
  const indexTip = hand?.[8];
  const pinched = thumbTip && indexTip && Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) <= 0.06;

  // 例: 定型ジェスチャー(スコア上位1件)
  const name = handResult.gestures?.[0]?.[0]?.categoryName; // "ILoveYou" など
  if (name === "ILoveYou") {
    /* 🤟 検出 */
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

## つまずきやすいポイント

- **座標は正規化値**: landmark の x, y は 0..1(画像サイズ非依存)。原点は左上。ピクセルに直すには表示サイズを掛ける
- **ミラー表示との不一致**: 自撮り映像は CSS `transform: scaleX(-1)` でミラーするのが普通だが、検出座標は**非ミラーの生値**。描画時に `x → 1 − x` の変換を忘れると左右が逆になる
- **メソッド名の違い**: FaceLandmarker は `detectForVideo()`、GestureRecognizer は `recognizeForVideo()`
- **タイムスタンプ**: 第2引数は毎回増加させる(`performance.now()` でよい)。同じ値を渡すとエラーや空結果になる
- **HTTPS 必須**: `getUserMedia` は secure context でしか動かない。`localhost` は例外的に OK。GitHub Pages は HTTPS なので問題なし
- **初回ロードが重い**: WASM + モデルで数MB(GestureRecognizer は Hand より少し大きい)。ローディング表示を必ず入れる。2回目以降はブラウザキャッシュが効く
- **GPU delegate が失敗する端末がある**: `delegate: "GPU"` の初期化が throw したら `"CPU"` で作り直すフォールバックを入れる
- **video を display:none にしない**: 検出用の `<video>` を `display:none` にすると再生が止まり検出できなくなる端末がある。隠したい場合は 1〜2px + `opacity: 0` にする(本プロジェクトのソロ練習モードで採用)

## 参考リンク

- 公式ドキュメント: https://ai.google.dev/edge/mediapipe/solutions/guide
- FaceLandmarker (Web): https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- GestureRecognizer (Web): https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer/web_js
- HandLandmarker (Web): https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
