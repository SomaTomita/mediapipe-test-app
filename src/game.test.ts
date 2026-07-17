import { describe, it, expect } from "vitest";
import {
  SHOT_COOLDOWN_MS,
  CATCH_RADIUS,
  HEART_FLIGHT_MS,
  MAX_HP,
  DAMAGE_NORMAL,
  DAMAGE_SPECIAL,
  HEAL_PERFECT,
  PINCH_THRESHOLD,
  PINCH_CATCH_RADIUS,
  SPECIAL_FLIGHT_MS,
  SPECIAL_HOLD_MS,
  SPECIAL_COOLDOWN_MS,
  FLICK_FLIGHT_MS,
  REFLECT_RADIUS,
  REFLECT_COOLDOWN_MS,
  spawnHeart,
  heartFlightMs,
  heartDamage,
  heartPosition,
  judgeCatch,
  expireHearts,
  isPinched,
  midpoint,
  resolveShot,
  isOpenHand,
  coverMap,
  canReflect,
  canOpenCatch,
  judgeReflect,
  createMatch,
  applyDamage,
  healHp,
  onOpponentLife,
  pickPrompt,
  type Heart,
  type Point,
} from "./game";

describe("resolveShot(指ハート発射)", () => {
  it("クールダウン中は撃てない", () => {
    expect(resolveShot(100, 1000 + SHOT_COOLDOWN_MS - 1, 1000, -Infinity)).toBeNull();
  });
  it("クールダウン明けの短いピンチは通常ショット", () => {
    expect(resolveShot(100, 1000 + SHOT_COOLDOWN_MS, 1000, -Infinity)).toBe("normal");
  });
  it("SPECIAL_HOLD_MS 以上の長押しはチャージ弾", () => {
    expect(resolveShot(SPECIAL_HOLD_MS, 10000, 0, -Infinity)).toBe("special");
  });
  it("チャージのクールダウン中は、長押ししても通常ショットになる", () => {
    const lastSpecialAt = 10000;
    const now = lastSpecialAt + SPECIAL_COOLDOWN_MS - 1;
    expect(resolveShot(SPECIAL_HOLD_MS * 2, now, 0, lastSpecialAt)).toBe("normal");
  });
  it("チャージのクールダウンが明けたら再びチャージ弾", () => {
    const lastSpecialAt = 10000;
    const now = lastSpecialAt + SPECIAL_COOLDOWN_MS;
    expect(resolveShot(SPECIAL_HOLD_MS, now, 0, lastSpecialAt)).toBe("special");
  });
});

describe("hearts", () => {
  it("spawnHeart はハートを追加し kind を保持する", () => {
    const hearts = spawnHeart([], 1, 0.5, 1000, "special");
    expect(hearts).toHaveLength(1);
    expect(hearts[0]).toMatchObject({ id: 1, x: 0.5, bornAt: 1000, kind: "special" });
  });

  it("飛行時間: 通常は遅く、チャージ弾は少しだけ速い", () => {
    expect(heartFlightMs({ id: 1, x: 0.5, bornAt: 0 })).toBe(HEART_FLIGHT_MS);
    expect(heartFlightMs({ id: 2, x: 0.5, bornAt: 0, kind: "special" })).toBe(SPECIAL_FLIGHT_MS);
    expect(heartFlightMs({ id: 3, x: 0.5, bornAt: 0, kind: "flick" })).toBe(FLICK_FLIGHT_MS);
    expect(SPECIAL_FLIGHT_MS).toBeLessThan(HEART_FLIGHT_MS); // 「少し早い」
    expect(HEART_FLIGHT_MS - SPECIAL_FLIGHT_MS).toBeLessThan(HEART_FLIGHT_MS / 2); // 極端に速くはない
  });

  it("被弾ダメージ: チャージ弾は重い", () => {
    expect(heartDamage(undefined)).toBe(DAMAGE_NORMAL);
    expect(heartDamage("flick")).toBe(DAMAGE_NORMAL);
    expect(heartDamage("special")).toBe(DAMAGE_SPECIAL);
  });

  it("heartPosition は 0→1 へ線形落下(kind ごとの飛行時間)", () => {
    const h: Heart = { id: 1, x: 0.3, bornAt: 0 };
    expect(heartPosition(h, 0).y).toBe(0);
    expect(heartPosition(h, HEART_FLIGHT_MS / 2).y).toBeCloseTo(0.5);
    expect(heartPosition(h, HEART_FLIGHT_MS * 2).y).toBe(1); // 頭打ち
    const s: Heart = { id: 2, x: 0.3, bornAt: 0, kind: "special" };
    expect(heartPosition(s, SPECIAL_FLIGHT_MS / 2).y).toBeCloseTo(0.5);
  });

  it("expireHearts は kind ごとの飛行時間で失効させる", () => {
    const hearts: Heart[] = [
      { id: 1, x: 0.5, bornAt: 0, kind: "special" },
      { id: 2, x: 0.5, bornAt: 0 },
    ];
    const { missed, remaining } = expireHearts(hearts, SPECIAL_FLIGHT_MS + 1);
    expect(missed.map((h) => h.id)).toEqual([1]);
    expect(remaining.map((h) => h.id)).toEqual([2]);
  });
});

describe("judgeCatch", () => {
  it("範囲内のハートをすべてキャッチする", () => {
    let hearts = spawnHeart([], 1, 0.5, 0);
    hearts = spawnHeart(hearts, 2, 0.52, 0);
    hearts = spawnHeart(hearts, 3, 0.9, 0);
    const t = HEART_FLIGHT_MS / 2; // y=0.5
    const { caught, remaining } = judgeCatch(hearts, { x: 0.5, y: 0.5 }, t);
    expect(caught.sort()).toEqual([1, 2]);
    expect(remaining.map((h) => h.id)).toEqual([3]);
  });

  it("つまみキャッチの半径は通常キャッチと同じ(つまめたら確実に取れる)", () => {
    // つまむジェスチャー自体が難しいので、半径で不利にしない
    expect(PINCH_CATCH_RADIUS).toBe(CATCH_RADIUS);
    const hearts = spawnHeart([], 1, 0.5 + 0.1, 0);
    const palm = { x: 0.5, y: 0 };
    expect(judgeCatch(hearts, palm, 0, PINCH_CATCH_RADIUS).caught).toEqual([1]);
  });

  it("palm が null なら何もキャッチしない", () => {
    const hearts = spawnHeart([], 1, 0.5, 0);
    const { caught, remaining } = judgeCatch(hearts, null, 0);
    expect(caught).toEqual([]);
    expect(remaining).toHaveLength(1);
  });
});

describe("ピンチ検出", () => {
  it("指先距離がしきい値以下ならピンチ", () => {
    expect(isPinched({ x: 0.5, y: 0.5 }, { x: 0.5 + PINCH_THRESHOLD - 0.001, y: 0.5 })).toBe(true);
  });
  it("しきい値を超えたらピンチではない", () => {
    expect(isPinched({ x: 0.5, y: 0.5 }, { x: 0.5 + PINCH_THRESHOLD + 0.001, y: 0.5 })).toBe(false);
  });
  it("midpoint は2点の中点を返す", () => {
    const m = midpoint({ x: 0.2, y: 0.4 }, { x: 0.4, y: 0.8 });
    expect(m.x).toBeCloseTo(0.3);
    expect(m.y).toBeCloseTo(0.6);
  });
});

describe("🫴 お皿の手(isOpenHand)", () => {
  // 手首(0)を基準に、MCP と指先の距離で合成データを作る
  const buildHand = (tipDists: [number, number, number, number]): Point[] => {
    const pts: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }));
    const mcps = [5, 9, 13, 17];
    const tips = [8, 12, 16, 20];
    mcps.forEach((i, k) => {
      pts[i] = { x: 0.44 + k * 0.04, y: 0.8 }; // 手首から約0.11
    });
    tips.forEach((i, k) => {
      pts[i] = { x: 0.44 + k * 0.04, y: 0.9 - tipDists[k] };
    });
    return pts;
  };

  it("4本指が伸びていれば開いている", () => {
    expect(isOpenHand(buildHand([0.3, 0.32, 0.31, 0.28]))).toBe(true);
  });

  it("握りこぶし(指先が手首の近く)は開いていない", () => {
    expect(isOpenHand(buildHand([0.08, 0.08, 0.08, 0.08]))).toBe(false);
  });

  it("3本伸びていれば開いている扱い(1本曲がっていても許容)", () => {
    expect(isOpenHand(buildHand([0.3, 0.3, 0.3, 0.08]))).toBe(true);
  });

  it("2本しか伸びていなければ開いていない", () => {
    expect(isOpenHand(buildHand([0.3, 0.3, 0.08, 0.08]))).toBe(false);
  });

  it("ランドマークが揃っていなければ false", () => {
    expect(isOpenHand([])).toBe(false);
  });
});

describe("🤟弾き返し", () => {
  it("🤟の手の範囲内のハートを弾き返す", () => {
    const hearts = spawnHeart([], 1, 0.5, 0);
    const { flicked, remaining } = judgeReflect(hearts, { x: 0.5, y: 0.05 }, 0);
    expect(flicked.map((h) => h.id)).toEqual([1]);
    expect(remaining).toEqual([]);
  });

  it("範囲外(REFLECT_RADIUS超)のハートは弾き返さない", () => {
    const hearts = spawnHeart([], 1, 0.5 + REFLECT_RADIUS + 0.01, 0);
    const { flicked, remaining } = judgeReflect(hearts, { x: 0.5, y: 0 }, 0);
    expect(flicked).toEqual([]);
    expect(remaining).toHaveLength(1);
  });

  it("point が null なら何もしない", () => {
    const hearts = spawnHeart([], 1, 0.5, 0);
    const { flicked, remaining } = judgeReflect(hearts, null, 0);
    expect(flicked).toEqual([]);
    expect(remaining).toHaveLength(1);
  });

  it("複数ハートをまとめて弾き返せる", () => {
    let hearts = spawnHeart([], 1, 0.5, 0);
    hearts = spawnHeart(hearts, 2, 0.52, 0);
    const { flicked } = judgeReflect(hearts, { x: 0.5, y: 0.05 }, 0);
    expect(flicked.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  it("canReflect はクールダウンを判定する", () => {
    expect(canReflect(-Infinity, 0)).toBe(true);
    expect(canReflect(1000, 1000 + REFLECT_COOLDOWN_MS - 1)).toBe(false);
    expect(canReflect(1000, 1000 + REFLECT_COOLDOWN_MS)).toBe(true);
  });

  it("クールダウンは10秒(1回使うと10秒使えない)", () => {
    expect(REFLECT_COOLDOWN_MS).toBe(10_000);
  });
});

describe("canOpenCatch(お皿キャッチの成立条件)", () => {
  it("✋ パーならキャッチできる", () => {
    expect(canOpenCatch(true, false, false)).toBe(true);
  });

  it("ピンチ中はキャッチできない(発射準備・つまみキャッチと排他)", () => {
    expect(canOpenCatch(true, true, false)).toBe(false);
  });

  it("パーでもピンチでも🤟でもない手はキャッチできない", () => {
    expect(canOpenCatch(false, false, false)).toBe(false);
  });

  it("🤟中はキャッチではなく弾き返しに委ねる", () => {
    expect(canOpenCatch(true, false, true)).toBe(false);
  });

  it("クールダウン中でも🤟中はキャッチ不可(強力な技のリスクとして意図された仕様)", () => {
    // 回復したと勘違いして🤟を出すと、弾き返せない上にキャッチもできない
    expect(canOpenCatch(true, false, true)).toBe(false);
    expect(canOpenCatch(false, false, true)).toBe(false);
  });
});

describe("体力ゲージ(match state)", () => {
  it("初期状態は playing で両者HP満タン", () => {
    expect(createMatch()).toEqual({ phase: "playing", myHp: MAX_HP, theirHp: MAX_HP });
  });

  it("被弾でHPが減る", () => {
    const m = applyDamage(createMatch(), DAMAGE_NORMAL);
    expect(m.myHp).toBe(MAX_HP - DAMAGE_NORMAL);
    expect(m.phase).toBe("playing");
  });

  it("HPが0になったら lose(0未満にはならない)", () => {
    let m = createMatch();
    m = applyDamage(m, MAX_HP - 5);
    m = applyDamage(m, DAMAGE_SPECIAL);
    expect(m.myHp).toBe(0);
    expect(m.phase).toBe("lose");
  });

  it("つまみキャッチの回復は MAX_HP で頭打ち", () => {
    let m = applyDamage(createMatch(), DAMAGE_NORMAL);
    m = healHp(m, HEAL_PERFECT);
    expect(m.myHp).toBe(MAX_HP - DAMAGE_NORMAL + HEAL_PERFECT);
    m = healHp(m, MAX_HP);
    expect(m.myHp).toBe(MAX_HP);
  });

  it("相手のHP 0 通知で win", () => {
    const m = onOpponentLife(createMatch(), 0);
    expect(m.theirHp).toBe(0);
    expect(m.phase).toBe("win");
  });

  it("自分が lose 確定後に相手も 0 なら draw", () => {
    let m = applyDamage(createMatch(), MAX_HP);
    expect(m.phase).toBe("lose");
    m = onOpponentLife(m, 0);
    expect(m.phase).toBe("draw");
  });

  it("HPが残っていれば playing のまま", () => {
    let m = applyDamage(createMatch(), DAMAGE_NORMAL);
    m = onOpponentLife(m, 40);
    expect(m.phase).toBe("playing");
  });
});

describe("coverMap(object-fit: cover の座標補正)", () => {
  it("映像と表示のアスペクト比が同じなら恒等写像", () => {
    const p = coverMap({ x: 0.3, y: 0.7 }, 640, 480, 320, 240);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.7);
  });

  it("中心は常に中心に写る", () => {
    const p = coverMap({ x: 0.5, y: 0.5 }, 640, 480, 300, 400);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.5);
  });

  it("横長映像を縦長表示(cover)にすると左右がはみ出す", () => {
    // video 400x300 を view 300x400 に cover 表示: scale=4/3, dispW=533.3
    const left = coverMap({ x: 0, y: 0.5 }, 400, 300, 300, 400);
    expect(left.x).toBeCloseTo((0 * 533.3333 - 116.6667) / 300, 3); // ≈ -0.389(画面外)
    expect(left.y).toBeCloseTo(0.5);
    const quarter = coverMap({ x: 0.25, y: 0.5 }, 400, 300, 300, 400);
    expect(quarter.x).toBeCloseTo((0.25 * 533.3333 - 116.6667) / 300, 3); // ≈ 0.0556
  });

  it("縦方向も同様に補正される(縦長映像を横長表示)", () => {
    const top = coverMap({ x: 0.5, y: 0 }, 300, 400, 400, 300);
    expect(top.y).toBeLessThan(0); // 上がはみ出す
    expect(top.x).toBeCloseTo(0.5);
  });

  it("映像サイズが未確定(0)のときはそのまま返す", () => {
    const p = coverMap({ x: 0.4, y: 0.6 }, 0, 0, 300, 400);
    expect(p).toEqual({ x: 0.4, y: 0.6 });
  });
});

describe("pickPrompt", () => {
  const prompts = ["a", "b", "c"];
  it("seed から決定的に選ぶ", () => {
    expect(pickPrompt(0, prompts)).toBe("a");
    expect(pickPrompt(4, prompts)).toBe("b");
    expect(pickPrompt(4, prompts)).toBe(pickPrompt(4, prompts));
  });
  it("大きな seed でも範囲内に収める", () => {
    expect(pickPrompt(1_000_000, prompts)).toBe(prompts[1_000_000 % prompts.length]);
  });
});
