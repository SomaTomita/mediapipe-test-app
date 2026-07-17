import { describe, it, expect } from "vitest";
import { pruneEffects, type Effect } from "./render";

const eff = (bornAt: number): Effect => ({ kind: "catch", x: 0.5, y: 0.5, bornAt });

describe("pruneEffects", () => {
  it("寿命内のエフェクトは残す", () => {
    const effects = [eff(1000)];
    expect(pruneEffects(effects, 1200)).toHaveLength(1);
  });

  it("寿命(700ms)を超えたエフェクトは除去する", () => {
    const effects = [eff(0)];
    expect(pruneEffects(effects, 701)).toHaveLength(0);
  });

  it("新旧混在で古いものだけを落とす", () => {
    const effects = [eff(0), eff(500), eff(900)];
    const kept = pruneEffects(effects, 1000); // 経過: 1000, 500, 100ms
    expect(kept.map((e) => e.bornAt)).toEqual([500, 900]);
  });

  it("空配列はそのまま空", () => {
    expect(pruneEffects([], 5000)).toEqual([]);
  });
});
