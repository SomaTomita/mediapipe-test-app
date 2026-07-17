import { describe, it, expect } from "vitest";
import { ROOM_CHARS, ROOM_LENGTH, randomRoom, peerId, normalizeRoom, isValidRoom } from "./room";

describe("randomRoom", () => {
  it("常に ROOM_LENGTH 文字を返す", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomRoom()).toHaveLength(ROOM_LENGTH);
    }
  });

  it("生成コードは ROOM_CHARS の文字だけで構成される", () => {
    for (let i = 0; i < 50; i++) {
      for (const ch of randomRoom()) {
        expect(ROOM_CHARS).toContain(ch);
      }
    }
  });

  it("生成コードは常に参加バリデーションを通過する(I/O を含まないため)", () => {
    for (let i = 0; i < 100; i++) {
      expect(isValidRoom(randomRoom())).toBe(true);
    }
  });

  it("rng を差し替えると決定的に生成できる", () => {
    const rng = () => 0; // 常に先頭文字
    expect(randomRoom(rng)).toBe(ROOM_CHARS[0].repeat(ROOM_LENGTH));
  });

  it("紛らわしい I と O は生成候補に含まれない", () => {
    expect(ROOM_CHARS).not.toContain("I");
    expect(ROOM_CHARS).not.toContain("O");
  });
});

describe("peerId", () => {
  it("cmh- プレフィックスを付ける", () => {
    expect(peerId("AXQZ")).toBe("cmh-AXQZ");
  });
});

describe("normalizeRoom", () => {
  it("大文字化する", () => {
    expect(normalizeRoom("axqz")).toBe("AXQZ");
  });
  it("前後の空白を除去する", () => {
    expect(normalizeRoom("  axqz  ")).toBe("AXQZ");
  });
});

describe("isValidRoom", () => {
  it.each(["ABCD", "AXQZ", "ZZZZ"])("英大文字4文字 %s は妥当", (r) => {
    expect(isValidRoom(r)).toBe(true);
  });

  it.each(["abc", "ABCDE", "AB1D", "AB D", "", "ＡＢＣＤ"])("不正な入力 %s は弾く", (r) => {
    expect(isValidRoom(r)).toBe(false);
  });

  it("normalize してから検証すると小文字入力も通る", () => {
    expect(isValidRoom(normalizeRoom("axqz"))).toBe(true);
  });
});
