// ルームコード関連の純ロジック(peerjs 非依存 → 単体テスト可能)

// 紛らわしい I / O は生成時に除外する
export const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_LENGTH = 4;

/** ルームコードを生成する。rng を差し替えると決定的にテストできる。 */
export function randomRoom(rng: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < ROOM_LENGTH; i++) {
    s += ROOM_CHARS[Math.floor(rng() * ROOM_CHARS.length)];
  }
  return s;
}

/** PeerJS の Peer ID 規約。cmh = Catch My Heart */
export function peerId(room: string): string {
  return `cmh-${room}`;
}

/** 入力を大文字化し前後空白を除去する(検証・接続前の正規化)。 */
export function normalizeRoom(input: string): string {
  return input.trim().toUpperCase();
}

/** 参加コードとして妥当か(英大文字4文字)。 */
export function isValidRoom(input: string): boolean {
  return new RegExp(`^[A-Z]{${ROOM_LENGTH}}$`).test(input);
}
