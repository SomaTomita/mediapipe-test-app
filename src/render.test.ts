import { describe, it, expect } from "vitest";
import {
  pruneEffects,
  effectDuration,
  ringKind,
  EFFECT_MS,
  RISE_MS,
  type Effect,
  type EffectKind,
  type SkeletonHand,
} from "./render";

const eff = (bornAt: number, kind: EffectKind = "catch"): Effect => ({ kind, x: 0.5, y: 0.5, bornAt });

describe("pruneEffects", () => {
  it("寿命内のエフェクトは残す", () => {
    const effects = [eff(1000)];
    expect(pruneEffects(effects, 1200)).toHaveLength(1);
  });

  it("寿命(700ms)を超えたエフェクトは除去する", () => {
    const effects = [eff(0)];
    expect(pruneEffects(effects, EFFECT_MS + 1)).toHaveLength(0);
  });

  it("新旧混在で古いものだけを落とす", () => {
    const effects = [eff(0), eff(500), eff(900)];
    const kept = pruneEffects(effects, 1000); // 経過: 1000, 500, 100ms
    expect(kept.map((e) => e.bornAt)).toEqual([500, 900]);
  });

  it("空配列はそのまま空", () => {
    expect(pruneEffects([], 5000)).toEqual([]);
  });

  it("上昇系(fire/special/flick)は通常エフェクトより長生きする", () => {
    expect(RISE_MS).toBeGreaterThan(EFFECT_MS);
    for (const kind of ["fire", "special", "flick"] as const) {
      expect(effectDuration(kind)).toBe(RISE_MS);
      // 通常寿命(700ms)を過ぎても上昇中は残る
      expect(pruneEffects([eff(0, kind)], EFFECT_MS + 1)).toHaveLength(1);
      // 上昇が終わったら消える
      expect(pruneEffects([eff(0, kind)], RISE_MS + 1)).toHaveLength(0);
    }
  });

  it("catch/perfect/pop は従来の寿命(700ms)のまま", () => {
    for (const kind of ["catch", "perfect", "pop"] as const) {
      expect(effectDuration(kind)).toBe(EFFECT_MS);
    }
  });
});

describe("ringKind(手の状態→リング種別)", () => {
  const hand = (o: Partial<SkeletonHand>): SkeletonHand => ({
    points: [],
    pinched: false,
    reflecting: false,
    open: false,
    facing: "unknown",
    ...o,
  });
  it("🤟中は reflect が最優先", () => {
    expect(ringKind(hand({ reflecting: true, pinched: true }))).toBe("reflect");
  });
  it("手のひらピンチは heal", () => {
    expect(ringKind(hand({ pinched: true, facing: "palm" }))).toBe("heal");
  });
  it("手の甲ピンチは shoot", () => {
    expect(ringKind(hand({ pinched: true, facing: "back" }))).toBe("shoot");
  });
  it("パーは catch", () => {
    expect(ringKind(hand({ open: true }))).toBe("catch");
  });
  it("該当なしは idle", () => {
    expect(ringKind(hand({}))).toBe("idle");
  });
});
