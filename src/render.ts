// Canvas 2D 描画(ナイーブアート調: フラットカラー+黒アウトライン)
// 座標は表示空間の正規化値 (0..1) を受け取る
import {
  type Heart,
  type Point,
  heartPosition,
  palmCenter,
  CATCH_RADIUS,
  PINCH_CATCH_RADIUS,
  REFLECT_RADIUS,
} from "./game";

export type EffectKind =
  | "catch" // キャッチ成功
  | "perfect" // つまみキャッチ(パーフェクト)
  | "pop" // 取り逃し
  | "fire" // 通常ショット発射
  | "special" // チャージショット発射
  | "flick"; // 打ち返し成立

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  bornAt: number;
}

/** 骨格描画用の手(表示空間の21点) */
export interface SkeletonHand {
  points: Point[];
  pinched: boolean;
  reflecting: boolean; // 🤟中
  open: boolean; // 🫴 お皿の手(キャッチ可能)
}

export const EFFECT_MS = 700; // その場エフェクト(catch / perfect / pop)
export const RISE_MS = 1100; // 上昇エフェクト(fire / special / flick): 上端まで飛んでいく

/** エフェクト種別ごとの寿命。上昇系は画面上端まで飛ぶため長め。 */
export function effectDuration(kind: EffectKind): number {
  return kind === "fire" || kind === "special" || kind === "flick" ? RISE_MS : EFFECT_MS;
}

// 色鉛筆スケッチ風のくすみパレット(style.css と揃える)
const INK = "#3f3a35";
const RED = "#c9452e";
const YELLOW = "#e3b23c";
const GREEN = "#8aa86f";
const PURPLE = "#8a5a83";
const PAPER = "#fffdf7";

// MediaPipe Hands の21点の接続(骨)
const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // 親指
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // 人差し指
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // 中指
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // 薬指
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // 小指
  [0, 17], // 手のひら外縁
];
const FINGER_TIPS = [4, 8, 12, 16, 20];

export function pruneEffects(effects: Effect[], now: number): Effect[] {
  return effects.filter((e) => now - e.bornAt < effectDuration(e.kind));
}

/** 手描き風ハートのパスを作る(中心 x,y・サイズ s) */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.4);
  ctx.bezierCurveTo(x - s * 0.62, y + s * 0.05, x - s * 0.48, y - s * 0.45, x, y - s * 0.12);
  ctx.bezierCurveTo(x + s * 0.48, y - s * 0.45, x + s * 0.62, y + s * 0.05, x, y + s * 0.4);
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string, rotate = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  heartPath(ctx, 0, 0, s);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function heartStyle(kind: Heart["kind"]): { fill: string; scale: number } {
  if (kind === "special") return { fill: YELLOW, scale: 1.3 };
  if (kind === "flick") return { fill: PURPLE, scale: 1.1 };
  return { fill: RED, scale: 1 };
}

/** 手の骨格(関節とボーン)をスケッチ調に描く */
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: SkeletonHand,
  w: number,
  h: number,
  base: number,
  now: number,
): void {
  const pts = hand.points;
  if (pts.length < 21) return;
  const px = (i: number) => pts[i].x * w;
  const py = (i: number) => pts[i].y * h;

  // ボーン(下地の白+インクの二重線で手描き感)
  for (const pass of [
    { color: "rgba(255,253,247,0.85)", width: base * 0.012 },
    { color: "rgba(63,58,53,0.75)", width: base * 0.005 },
  ]) {
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // 関節ドット
  for (let i = 0; i < 21; i++) {
    const tip = FINGER_TIPS.includes(i);
    ctx.beginPath();
    ctx.arc(px(i), py(i), base * (tip ? 0.011 : 0.007), 0, Math.PI * 2);
    ctx.fillStyle = tip ? RED : PAPER;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // 状態リング: 判定点と同じ場所・同じ半径で描く(見た目=当たり判定)
  // 🤟=紫 / ✋パー=白(キャッチ可能) / ピンチ=赤(つまみキャッチ) / それ以外=薄いグレー
  const ringR = base * (hand.reflecting ? REFLECT_RADIUS : hand.pinched ? PINCH_CATCH_RADIUS : CATCH_RADIUS);
  const pc = palmCenter(pts) ?? pts[9]; // 判定点(main.ts と同じ手のひら中心)
  const ringX = hand.pinched ? (px(4) + px(8)) / 2 : pc.x * w;
  const ringY = hand.pinched ? (py(4) + py(8)) / 2 : pc.y * h;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  if (hand.reflecting) {
    ctx.strokeStyle = PURPLE;
    ctx.lineWidth = base * 0.014;
  } else if (hand.pinched) {
    ctx.strokeStyle = "rgba(201,69,46,0.9)";
    ctx.lineWidth = base * 0.01;
  } else if (hand.open) {
    ctx.strokeStyle = "rgba(255,253,247,0.95)";
    ctx.lineWidth = base * 0.012;
  } else {
    ctx.strokeStyle = "rgba(255,253,247,0.35)";
    ctx.lineWidth = base * 0.007;
  }
  ctx.setLineDash([base * 0.045, base * 0.03]);
  ctx.lineDashOffset = -(now / 40);
  ctx.stroke();
  ctx.setLineDash([]);

  // ピンチ中は指ハートの位置に小さなハート
  if (hand.pinched) {
    const mx = (px(4) + px(8)) / 2;
    const my = (py(4) + py(8)) / 2;
    drawHeart(ctx, mx, my, base * 0.045, RED);
  }
  // 🤟中は手のひら(判定点)に紫ハート
  if (hand.reflecting) {
    drawHeart(ctx, pc.x * w, pc.y * h, base * 0.04, PURPLE);
  }
}

export function drawFrame(
  canvas: HTMLCanvasElement,
  hearts: Heart[],
  hands: SkeletonHand[],
  effects: Effect[],
  now: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const base = Math.min(w, h);

  // 飛来ハート(ゆらゆら+くるくる)
  for (const heart of hearts) {
    const p = heartPosition(heart, now);
    const t = now - heart.bornAt;
    const wobble = Math.sin(t / 190 + heart.id) * 0.02;
    const rot = Math.sin(t / 300 + heart.id * 2) * 0.22;
    const { fill, scale } = heartStyle(heart.kind);
    drawHeart(ctx, (p.x + wobble) * w, p.y * h, base * 0.075 * scale, fill, rot);
    if (heart.kind === "special") {
      ctx.font = `${base * 0.03}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", (p.x + wobble + 0.05) * w, (p.y - 0.04) * h);
    }
  }

  // 手の骨格(両手)
  for (const hand of hands) {
    drawSkeleton(ctx, hand, w, h, base, now);
  }

  // エフェクト
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const e of effects) {
    const t = (now - e.bornAt) / effectDuration(e.kind); // 0..1
    ctx.save();
    ctx.globalAlpha = 1 - t;
    const label = (text: string, color: string, dy: number) => {
      ctx.font = `700 ${base * 0.05}px "Yusei Magic", sans-serif`;
      ctx.lineWidth = base * 0.012;
      ctx.strokeStyle = INK;
      ctx.strokeText(text, e.x * w, (e.y + dy) * h);
      ctx.fillStyle = color;
      ctx.fillText(text, e.x * w, (e.y + dy) * h);
    };
    switch (e.kind) {
      case "catch":
        drawHeart(ctx, e.x * w, e.y * h, base * (0.07 + t * 0.09), GREEN);
        label("キャッチ!", PAPER, -0.11 - t * 0.04);
        break;
      case "perfect":
        drawHeart(ctx, e.x * w, e.y * h, base * (0.08 + t * 0.12), YELLOW, Math.PI * t * 0.5);
        label("パーフェクト!", YELLOW, -0.13 - t * 0.05);
        break;
      case "pop":
        ctx.font = `${base * (0.08 + t * 0.08)}px serif`;
        ctx.fillText("💔", e.x * w, e.y * h);
        break;
      case "fire":
      case "special":
      case "flick": {
        // 相手画面へ飛んでいく感: 発生位置から画面上端まで上昇し、縮みながらフェード
        const color = e.kind === "fire" ? RED : e.kind === "special" ? YELLOW : PURPLE;
        const size = e.kind === "special" ? 0.085 : 0.065;
        ctx.globalAlpha = t < 0.75 ? 1 : (1 - t) / 0.25;
        const rx = (e.x + Math.sin(t * 7 + e.bornAt) * 0.02 * t) * w;
        const ry = (e.y * (1 - t) - 0.06 * t) * h;
        drawHeart(ctx, rx, ry, base * size * (1 - t * 0.35), color, Math.sin(t * 5) * 0.35);
        if (t < 0.45) {
          ctx.globalAlpha = 1 - t / 0.45;
          if (e.kind === "special") label("チャージ!", YELLOW, 0.09);
          if (e.kind === "flick") label("うちかえし!", PURPLE, -0.1);
        }
        break;
      }
    }
    ctx.restore();
  }
}
