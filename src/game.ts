// ゲームロジック(DOM非依存の純関数)。仕様: docs/architecture/technical-reference.md

export const SHOT_COOLDOWN_MS = 800; // ハート発射の連射クールダウン
export const CATCH_RADIUS = 0.1; // 正規化距離(お皿の手)。広すぎると手応えがないため 0.12 → 0.10 に調整
export const HEART_FLIGHT_MS = 3200; // 通常ハート(基本は遅め)
export const MAX_HP = 100;
export const DAMAGE_NORMAL = 20; // 通常/打ち返しハートの被弾ダメージ
export const DAMAGE_SPECIAL = 30; // チャージ弾の被弾ダメージ
export const HEAL_PERFECT = 15; // つまみキャッチ1つあたりの回復量

// 指先機能
export const PINCH_THRESHOLD = 0.06; // 親指先(4)と人差し指先(8)の距離、<= でピンチ
export const PINCH_CATCH_RADIUS = 0.1; // つまみキャッチの判定半径。パーと同じ(パーより狭くして不利にはしない)
export const SPECIAL_FLIGHT_MS = 2400; // チャージ弾(通常より少しだけ速い)
export const SPECIAL_HOLD_MS = 600; // チャージ弾に必要なピンチ長押し時間
export const SPECIAL_COOLDOWN_MS = 3000;
export const SPECIAL_NEAR_FACE_DIST = 0.28; // ピンチ中点と鼻先の距離がこれ未満なら「顔の近く」
export const REFLECT_RADIUS = 0.13; // 🤟の手とハートの距離、<= で弾き返し
export const REFLECT_COOLDOWN_MS = 10_000; // 🤟は1回使うと10秒使えない(メーターで回復を表示)
export const FLICK_FLIGHT_MS = 2600; // 弾き返されたハートの飛行時間
export const OPEN_HAND_RATIO = 1.3; // 指先が MCP より 1.3 倍遠ければ「伸びている」
export const OPEN_FINGERS_REQUIRED = 3; // 4本中3本伸びていれば「お皿の手」

export type HeartKind = "special" | "flick";

export interface Heart {
  id: number;
  x: number; // 表示空間の正規化 x(受信値をそのまま使う)
  bornAt: number; // ms
  kind?: HeartKind; // 省略時は通常ハート
}

export interface Point {
  x: number;
  y: number;
}

export function spawnHeart(hearts: Heart[], id: number, x: number, now: number, kind?: HeartKind): Heart[] {
  return [...hearts, { id, x, bornAt: now, kind }];
}

export function heartFlightMs(heart: Heart): number {
  if (heart.kind === "special") return SPECIAL_FLIGHT_MS;
  if (heart.kind === "flick") return FLICK_FLIGHT_MS;
  return HEART_FLIGHT_MS;
}

export function heartDamage(kind?: HeartKind): number {
  return kind === "special" ? DAMAGE_SPECIAL : DAMAGE_NORMAL;
}

export function heartPosition(heart: Heart, now: number): Point {
  const y = Math.min(1, (now - heart.bornAt) / heartFlightMs(heart));
  return { x: heart.x, y };
}

export function judgeCatch(
  hearts: Heart[],
  palm: Point | null,
  now: number,
  radius: number = CATCH_RADIUS,
): { caught: number[]; remaining: Heart[] } {
  if (!palm) return { caught: [], remaining: hearts };
  const caught: number[] = [];
  const remaining: Heart[] = [];
  for (const h of hearts) {
    const p = heartPosition(h, now);
    const dist = Math.hypot(p.x - palm.x, p.y - palm.y);
    if (dist <= radius) caught.push(h.id);
    else remaining.push(h);
  }
  return { caught, remaining };
}

export function expireHearts(hearts: Heart[], now: number): { missed: Heart[]; remaining: Heart[] } {
  const missed: Heart[] = [];
  const remaining: Heart[] = [];
  for (const h of hearts) {
    if (now - h.bornAt > heartFlightMs(h)) missed.push(h);
    else remaining.push(h);
  }
  return { missed, remaining };
}

// ---- ピンチ(指ハート) ----

export function isPinched(thumbTip: Point, indexTip: Point): boolean {
  return Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) <= PINCH_THRESHOLD;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export type ShotKind = "normal" | "special";

/**
 * ピンチ(指ハート)を離した瞬間の発射判定。
 * heldMs: ピンチを維持していた時間。SPECIAL_HOLD_MS 以上でチャージ弾。
 */
export function resolveShot(heldMs: number, now: number, lastShotAt: number, lastSpecialAt: number): ShotKind | null {
  if (now - lastShotAt < SHOT_COOLDOWN_MS) return null;
  if (heldMs >= SPECIAL_HOLD_MS && now - lastSpecialAt >= SPECIAL_COOLDOWN_MS) return "special";
  return "normal";
}

// ---- 手のひら中心 ----

export const PALM_CENTER_LERP = 0.35; // 中指MCP(9)から手首(0)へ寄せる割合

/**
 * キャッチ・弾き返しの判定点。中指の付け根(9)そのままだと
 * 手の上寄りに判定円が出るため、手首方向へ少し下げた点を使う。
 */
export function palmCenter(landmarks: Point[]): Point | null {
  if (landmarks.length < 21) return null;
  const mcp = landmarks[9];
  const wrist = landmarks[0];
  return {
    x: mcp.x + (wrist.x - mcp.x) * PALM_CENTER_LERP,
    y: mcp.y + (wrist.y - mcp.y) * PALM_CENTER_LERP,
  };
}

// ---- ✋ パー(キャッチ姿勢) ----

/**
 * 手が「パー」に開いているか。
 * 4本指(人差し指〜小指)のうち OPEN_FINGERS_REQUIRED 本以上が
 * 手首から MCP の OPEN_HAND_RATIO 倍より遠くまで伸びていれば開いているとみなす。
 */
export function isOpenHand(landmarks: Point[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const fingers: ReadonlyArray<readonly [number, number]> = [
    [5, 8],
    [9, 12],
    [13, 16],
    [17, 20],
  ];
  let open = 0;
  for (const [mcp, tip] of fingers) {
    const dTip = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    const dMcp = Math.hypot(landmarks[mcp].x - wrist.x, landmarks[mcp].y - wrist.y);
    if (dTip > dMcp * OPEN_HAND_RATIO) open++;
  }
  return open >= OPEN_FINGERS_REQUIRED;
}

// ---- 🤟弾き返し ----

export const FOLDED_FINGER_RATIO = 1.1; // 指先が手首から MCP の 1.1 倍未満なら「畳まれている」

/**
 * 🤟(ILoveYou)の幾何判定。GestureRecognizer の定型分類は
 * トップ1が None に転ぶと反応しないため、フォールバックとして併用する。
 * 人差し指+小指が伸び、中指+薬指が畳まれていれば🤟(親指は誤検出が多いため見ない)。
 */
export function isILoveYou(landmarks: Point[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const dist = (i: number) => Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y);
  const extended = (mcp: number, tip: number) => dist(tip) > dist(mcp) * OPEN_HAND_RATIO;
  const folded = (mcp: number, tip: number) => dist(tip) < dist(mcp) * FOLDED_FINGER_RATIO;
  return extended(5, 8) && extended(17, 20) && folded(9, 12) && folded(13, 16);
}

export function canReflect(lastReflectAt: number, now: number): boolean {
  return now - lastReflectAt >= REFLECT_COOLDOWN_MS;
}

/**
 * 🫴 お皿キャッチが成立する手の状態か。
 * 🤟中はクールダウン中であってもキャッチ不可(意図された仕様):
 * 弾き返しは強力なため、回復を誤認して🤟を出すと
 * キャッチすらできなくなるリスクを技のコストとして負わせる。
 */
export function canOpenCatch(open: boolean, pinched: boolean, reflecting: boolean): boolean {
  return open && !pinched && !reflecting;
}

/** 🤟サインを出している手(point)に触れたハートを弾き返す。 */
export function judgeReflect(
  hearts: Heart[],
  point: Point | null,
  now: number,
): { flicked: Heart[]; remaining: Heart[] } {
  if (!point) return { flicked: [], remaining: hearts };
  const flicked: Heart[] = [];
  const remaining: Heart[] = [];
  for (const h of hearts) {
    const p = heartPosition(h, now);
    const dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (dist <= REFLECT_RADIUS) flicked.push(h);
    else remaining.push(h);
  }
  return { flicked, remaining };
}

// ---- 体力ゲージとマッチ状態 ----

export type MatchPhase = "playing" | "win" | "lose" | "draw";

export interface Match {
  phase: MatchPhase;
  myHp: number;
  theirHp: number;
}

export function createMatch(): Match {
  return { phase: "playing", myHp: MAX_HP, theirHp: MAX_HP };
}

function resolvePhase(myHp: number, theirHp: number): MatchPhase {
  if (myHp <= 0 && theirHp <= 0) return "draw";
  if (myHp <= 0) return "lose";
  if (theirHp <= 0) return "win";
  return "playing";
}

/** 被弾: 自分のHPを減らす(single writer: 自分のHPは自分だけが更新する) */
export function applyDamage(m: Match, damage: number): Match {
  const myHp = Math.max(0, m.myHp - damage);
  return { ...m, myHp, phase: resolvePhase(myHp, m.theirHp) };
}

/** 回復: つまみキャッチで自分のHPを回復(上限 MAX_HP) */
export function healHp(m: Match, amount: number): Match {
  const myHp = Math.min(MAX_HP, m.myHp + amount);
  return { ...m, myHp, phase: resolvePhase(myHp, m.theirHp) };
}

/** 相手からの life 通知(相手HPは表示専用) */
export function onOpponentLife(m: Match, theirHp: number): Match {
  return { ...m, theirHp, phase: resolvePhase(m.myHp, theirHp) };
}

export function pickPrompt(seed: number, prompts: string[]): string {
  return prompts[seed % prompts.length];
}

// ---- 表示座標の補正 ----

/**
 * `object-fit: cover` で表示された映像の「フレーム正規化座標」を、
 * 表示領域の正規化座標へ写像する(coverは拡大トリミングするため、
 * そのまま描くと手と骨格がズレる)。映像サイズ未確定時は恒等写像。
 */
export function coverMap(p: Point, videoW: number, videoH: number, viewW: number, viewH: number): Point {
  if (videoW <= 0 || videoH <= 0 || viewW <= 0 || viewH <= 0) return p;
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  const offX = (viewW - dispW) / 2;
  const offY = (viewH - dispH) / 2;
  return { x: (p.x * dispW + offX) / viewW, y: (p.y * dispH + offY) / viewH };
}
