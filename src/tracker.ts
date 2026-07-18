// MediaPipe Tasks Vision のラッパ。仕様: docs/architecture/technical-reference.md
import { FilesetResolver, FaceLandmarker, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { Point } from "./game";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const GESTURE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export interface HandDet {
  landmarks: Point[]; // 21点(非ミラー正規化座標)
  iloveyou: boolean; // 🤟 サイン(弾き返し)
  isRight: boolean; // MediaPipe handedness が Right か(手の向き判定に使用。現実の符号は handFacing の invert 引数で校正)
}

export interface Detection {
  nose: Point | null; // 鼻先 landmark 1(発射の「顔の近く」判定)
  hands: HandDet[]; // 片手プレイ前提で最大1本
}

export interface Tracker {
  detect(now: number): Detection;
}

async function createLandmarkers(delegate: "GPU" | "CPU") {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    runningMode: "VIDEO",
    outputFaceBlendshapes: false, // 表情は使わない(鼻先の位置のみ)
    numFaces: 1,
  });
  const gesture = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 1, // 片手プレイ前提(2本目は認識しない)
  });
  return { face, gesture };
}

export async function createTracker(video: HTMLVideoElement): Promise<Tracker> {
  let landmarkers;
  try {
    landmarkers = await createLandmarkers("GPU");
  } catch {
    landmarkers = await createLandmarkers("CPU");
  }
  const { face, gesture } = landmarkers;
  let lastTs = -1;

  // ウォームアップ: 初回推論はグラフ初期化・delegate生成で数秒メインスレッドを
  // ブロックするため、ローディング画面中に済ませる。対戦開始(カウントダウン)時に
  // 走らせると rAF・タイマーが凍結し「ハート静止・カウントダウンずれ」になる。
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => video.addEventListener("loadeddata", () => resolve(), { once: true }));
  }
  try {
    lastTs = performance.now();
    face.detectForVideo(video, lastTs);
    gesture.recognizeForVideo(video, lastTs);
  } catch (e) {
    console.error("tracker warm-up failed (実ループ側で再試行される)", e);
  }

  return {
    detect(now: number): Detection {
      // VIDEO モードはタイムスタンプの単調増加が必須
      const ts = now <= lastTs ? lastTs + 1 : now;
      lastTs = ts;

      const faceResult = face.detectForVideo(video, ts);
      const handResult = gesture.recognizeForVideo(video, ts);

      const noseLm = faceResult.faceLandmarks?.[0]?.[1] ?? null;

      const hands: HandDet[] = (handResult.landmarks ?? []).map((lms, i) => ({
        landmarks: lms.map((lm) => ({ x: lm.x, y: lm.y })),
        iloveyou: handResult.gestures?.[i]?.[0]?.categoryName === "ILoveYou",
        isRight: handResult.handedness?.[i]?.[0]?.categoryName === "Right",
      }));

      return {
        nose: noseLm ? { x: noseLm.x, y: noseLm.y } : null,
        hands,
      };
    },
  };
}
