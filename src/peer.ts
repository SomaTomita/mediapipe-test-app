// PeerJS 接続・メッセージ送受信。仕様: docs/architecture/technical-reference.md
import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { randomRoom, peerId } from "./room";

export type Msg =
  | { t: "hello" }
  | { t: "start"; seed: number }
  | { t: "heart"; id: number; x: number; kind?: "special" | "flick" } // ハート発射(kind省略=通常)
  | { t: "catch"; id: number }
  | { t: "miss"; id: number }
  | { t: "life"; mine: number }
  | { t: "rematch" };

export interface Session {
  send(msg: Msg): void;
  isHost: boolean;
  room: string;
  close(): void;
}

export interface SessionCallbacks {
  onMsg(msg: Msg): void;
  onRemoteStream(stream: MediaStream): void;
  onConnected(): void;
  onClosed(): void;
}

function wireData(conn: DataConnection, cb: SessionCallbacks) {
  conn.on("data", (data) => cb.onMsg(data as Msg));
  conn.on("close", () => cb.onClosed());
  conn.on("error", () => cb.onClosed());
}

/** ルームを作成して相手の接続を待つ。ROOM 衝突時は自動で振り直す。 */
export function hostRoom(
  localStream: MediaStream,
  cb: SessionCallbacks,
  onRoomReady: (room: string) => void,
): Promise<Session> {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tryHost = () => {
      const room = randomRoom();
      const peer = new Peer(peerId(room));
      let conn: DataConnection | null = null;

      peer.on("open", () => onRoomReady(room));

      peer.on("error", (err) => {
        if ((err as { type?: string }).type === "unavailable-id" && attempts < 5) {
          attempts++;
          peer.destroy();
          tryHost();
        } else {
          reject(err);
        }
      });

      peer.on("connection", (c) => {
        conn = c;
        wireData(c, cb);
        c.on("open", () => {
          cb.onConnected();
          resolve({
            isHost: true,
            room,
            send: (msg) => conn?.open && conn.send(msg),
            close: () => peer.destroy(),
          });
        });
      });

      peer.on("call", (call: MediaConnection) => {
        call.answer(localStream);
        call.on("stream", (remote) => cb.onRemoteStream(remote));
      });
    };

    tryHost();
  });
}

/** 既存ルームに参加する。DataConnection → call の順で発信する。 */
export function joinRoom(room: string, localStream: MediaStream, cb: SessionCallbacks): Promise<Session> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(); // ゲストはランダム ID
    peer.on("error", (err) => reject(err));

    peer.on("open", () => {
      const conn = peer.connect(peerId(room), { reliable: true });
      wireData(conn, cb);
      conn.on("open", () => {
        const call = peer.call(peerId(room), localStream);
        call.on("stream", (remote) => cb.onRemoteStream(remote));
        cb.onConnected();
        conn.send({ t: "hello" } satisfies Msg);
        resolve({
          isHost: false,
          room,
          send: (msg) => conn.open && conn.send(msg),
          close: () => peer.destroy(),
        });
      });
    });
  });
}
