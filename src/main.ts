import "./style.css";
import {
  MAX_HP,
  CATCH_RADIUS,
  PINCH_CATCH_RADIUS,
  HEAL_PERFECT,
  SPECIAL_HOLD_MS,
  SPECIAL_NEAR_FACE_DIST,
  REFLECT_COOLDOWN_MS,
  resolveShot,
  spawnHeart,
  heartPosition,
  heartDamage,
  judgeCatch,
  expireHearts,
  createMatch,
  applyDamage,
  healHp,
  onOpponentLife,
  pickPrompt,
  isPinched,
  isOpenHand,
  midpoint,
  coverMap,
  judgeReflect,
  canReflect,
  canOpenCatch,
  palmCenter,
  isILoveYou,
  countdownLabel,
  type Heart,
  type HeartKind,
  type Match,
  type ShotKind,
  type Point,
} from "./game";
import { createTracker, type Tracker } from "./tracker";
import { hostRoom, joinRoom, type Msg, type Session } from "./peer";
import { normalizeRoom, isValidRoom } from "./room";
import { drawFrame, pruneEffects, type Effect, type SkeletonHand } from "./render";
import { LOVE_PROMPTS } from "./prompts";

// ---- DOM ----
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const screens = {
  top: $("screen-top"),
  lobby: $("screen-lobby"),
  battle: $("screen-battle"),
  result: $("screen-result"),
};
const remoteVideo = $<HTMLVideoElement>("remote-video");
const selfVideo = $<HTMLVideoElement>("self-video");
const canvas = $<HTMLCanvasElement>("game-canvas");
const countdownEl = $("countdown");
const meterFill = $("charge-meter-fill");
const reflectCd = $("reflect-cd");
const reflectCdNum = $("reflect-cd-num");
const hpMineFill = $("hp-mine");
const hpTheirsFill = $("hp-theirs");
const barMine = $("bar-mine");
const barTheirs = $("bar-theirs");
const subMine = $("sub-mine");
const subTheirs = $("sub-theirs");
const hudCenter = $("hud-center");
const hudTheirLabel = $("hud-their-label");
const loading = $("loading");
const loadingText = $("loading-text");
const toastEl = $("toast");

// ---- 状態 ----
type Mode = "duo" | "solo";
let mode: Mode = "duo";
let localStream: MediaStream | null = null;
let tracker: Tracker | null = null;
let session: Session | null = null;

let match: Match = createMatch();
let hearts: Heart[] = [];
let effects: Effect[] = [];
let seed = 0;
let playing = false;
let loopRunning = false;
let myRematch = false;
let theirRematch = false;

// 指先系の状態(片手プレイ前提)
let pinchState: { startedAt: number; nearFace: boolean } | null = null;
let lastPinchMidRaw: Point | null = null;
let lastShotAt = -Infinity;
let lastSpecialAt = -Infinity;
let lastReflectAt = -Infinity;
let heartId = 0;

// ソロ練習
let soloNextSpawnAt = 0;
let soloHeartId = 0;
let soloCatches = 0;
let soloShots = 0;

// ---- 戦績 ----
interface Stats {
  wins: number;
  losses: number;
  draws: number;
  hearts: number;
}
const STATS_KEY = "cmh-stats";
const stats: Stats = (() => {
  try {
    return { wins: 0, losses: 0, draws: 0, hearts: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) ?? "{}") };
  } catch {
    return { wins: 0, losses: 0, draws: 0, hearts: 0 };
  }
})();
function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
function renderStatsLine() {
  const played = stats.wins + stats.losses + stats.draws;
  $("stats-line").textContent =
    played > 0 || stats.hearts > 0
      ? `これまでの記録 — ${stats.wins}勝 ${stats.losses}敗 ${stats.draws}分 / 撃ったハート ${stats.hearts}`
      : "";
}

// ---- UI ヘルパ ----
function showScreen(name: keyof typeof screens) {
  for (const [k, el] of Object.entries(screens)) {
    el.classList.toggle("hidden", k !== name);
  }
}

let toastTimer = 0;
function toast(text: string, ms = 3500) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function setLoading(text: string | null) {
  if (text === null) {
    loading.classList.add("hidden");
  } else {
    loadingText.textContent = text;
    loading.classList.remove("hidden");
  }
}

function updateHud() {
  if (mode === "duo") {
    barMine.classList.remove("hidden");
    barTheirs.classList.remove("hidden");
    hpMineFill.style.width = `${(match.myHp / MAX_HP) * 100}%`;
    hpTheirsFill.style.width = `${(match.theirHp / MAX_HP) * 100}%`;
    hpMineFill.classList.toggle("hp-low", match.myHp <= 30);
    hpTheirsFill.classList.toggle("hp-low", match.theirHp <= 30);
    subMine.textContent = `${match.myHp}`;
    subTheirs.textContent = `${match.theirHp}`;
    hudCenter.textContent = "VS";
    hudTheirLabel.textContent = "相手";
  } else {
    barMine.classList.add("hidden");
    barTheirs.classList.add("hidden");
    subMine.textContent = `発射 ${soloShots}`;
    subTheirs.textContent = `キャッチ ${soloCatches}`;
    hudCenter.textContent = "練習";
    hudTheirLabel.textContent = "成果";
  }
}

// ---- カメラ・トラッカー準備 ----
async function ensureReady(withAudio: boolean): Promise<boolean> {
  try {
    if (!localStream) {
      setLoading("カメラを準備しています…");
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: withAudio,
      });
      selfVideo.srcObject = localStream;
      await selfVideo.play().catch(() => {});
    }
    if (!tracker) {
      setLoading("AIモデルを読み込んでいます…(初回は少し時間がかかります)");
      tracker = await createTracker(selfVideo);
    }
    setLoading(null);
    return true;
  } catch (e) {
    setLoading(null);
    console.error(e);
    toast("カメラを使えませんでした。ブラウザのカメラ許可を確認してください");
    return false;
  }
}

function releaseMedia() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  selfVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// ---- 発射 ----
function sendHeart(x: number, kind?: HeartKind) {
  heartId++;
  session?.send({ t: "heart", id: heartId, x, kind });
}

function fireHearts(kind: ShotKind, rawX: number, effectX: number, now: number) {
  lastShotAt = now;
  stats.hearts++;
  saveStats();
  if (mode === "solo") {
    soloShots++;
    updateHud();
  }
  if (kind === "special") {
    lastSpecialAt = now;
    effects.push({ kind: "special", x: effectX, y: 0.72, bornAt: now });
    if (mode === "duo") sendHeart(rawX, "special");
  } else {
    effects.push({ kind: "fire", x: effectX, y: 0.76, bornAt: now });
    if (mode === "duo") sendHeart(rawX);
  }
}

// ---- 自分のHP変化(single writer)----
function damageSelf(kind: Heart["kind"], now: number, x: number) {
  effects.push({ kind: "pop", x, y: 0.92, bornAt: now });
  if (mode !== "duo") return;
  match = applyDamage(match, heartDamage(kind));
  session?.send({ t: "life", mine: match.myHp });
  updateHud();
}

function healSelf(count: number) {
  if (mode !== "duo") return;
  match = healHp(match, HEAL_PERFECT * count);
  session?.send({ t: "life", mine: match.myHp });
  updateHud();
}

// ---- ゲームループ ----
function syncCanvasSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function loop() {
  if (!loopRunning || !tracker) return;
  const now = performance.now();
  syncCanvasSize();
  const det = tracker.detect(now);

  // 片手プレイ前提: 最初の1本だけを使う
  const hand = det.hands[0] ?? null;
  const thumbTip = hand?.landmarks[4] ?? null;
  const indexTip = hand?.landmarks[8] ?? null;
  const palmRaw = hand ? palmCenter(hand.landmarks) : null;
  const pinched = !!(thumbTip && indexTip) && isPinched(thumbTip, indexTip);
  const pinchMidRaw = pinched && thumbTip && indexTip ? midpoint(thumbTip, indexTip) : null;
  if (pinchMidRaw) lastPinchMidRaw = pinchMidRaw;
  const open = hand ? isOpenHand(hand.landmarks) : false;
  // 分類(ILoveYou)が None に転んでも幾何判定でフォールバック
  const reflecting = !!hand && (hand.iloveyou || isILoveYou(hand.landmarks));

  // カメラフレーム座標 → ステージ表示座標(ミラー + object-fit: cover の拡大トリミング補正)
  const toStage = (p: Point): Point =>
    coverMap(
      { x: 1 - p.x, y: p.y },
      selfVideo.videoWidth,
      selfVideo.videoHeight,
      canvas.clientWidth,
      canvas.clientHeight,
    );
  const palmDisp = palmRaw ? toStage(palmRaw) : null;
  const pinchDisp = pinchMidRaw ? toStage(pinchMidRaw) : null;

  if (playing) {
    // 指ハート: ピンチ開始(顔の近くなら発射モード)
    if (pinched && !pinchState) {
      const nearFace =
        !!det.nose &&
        !!pinchMidRaw &&
        Math.hypot(pinchMidRaw.x - det.nose.x, pinchMidRaw.y - det.nose.y) < SPECIAL_NEAR_FACE_DIST;
      pinchState = { startedAt: now, nearFace };
    }
    // ピンチを離した瞬間に発射(長押しでチャージ弾)。手を見失ったときは発射しない
    if (pinchState && hand && !pinched) {
      if (pinchState.nearFace && lastPinchMidRaw) {
        const kind = resolveShot(now - pinchState.startedAt, now, lastShotAt, lastSpecialAt);
        if (kind) fireHearts(kind, lastPinchMidRaw.x, toStage(lastPinchMidRaw).x, now);
      }
      pinchState = null;
    }
    if (!hand) pinchState = null;

    // 🤟 弾き返し: サインを出した手に触れたハートを相手に返す
    const reflectReady = canReflect(lastReflectAt, now);
    if (reflecting && palmDisp && reflectReady) {
      const fr = judgeReflect(hearts, palmDisp, now);
      if (fr.flicked.length > 0) {
        hearts = fr.remaining;
        lastReflectAt = now;
        for (const fh of fr.flicked) {
          const p = heartPosition(fh, now);
          effects.push({ kind: "flick", x: p.x, y: p.y, bornAt: now });
          if (mode === "duo") sendHeart(fh.x, "flick");
        }
      }
    }

    // キャッチ: 顔から離れたピンチ=つまみキャッチ(回復)、🫴お皿の手=通常キャッチ
    // (🤟中はクールダウン中でもキャッチ不可 → canOpenCatch の意図コメント参照)
    const pinchCatching = pinched && pinchState !== null && !pinchState.nearFace;
    if (pinchCatching || canOpenCatch(open, pinched, reflecting)) {
      const catchPoint = pinchCatching ? pinchDisp : palmDisp;
      const radius = pinchCatching ? PINCH_CATCH_RADIUS : CATCH_RADIUS;
      const res = judgeCatch(hearts, catchPoint, now, radius);
      if (res.caught.length > 0) {
        hearts = res.remaining;
        effects.push({
          kind: pinchCatching ? "perfect" : "catch",
          x: catchPoint!.x,
          y: catchPoint!.y,
          bornAt: now,
        });
        if (pinchCatching) healSelf(res.caught.length);
        if (mode === "duo") {
          for (const id of res.caught) session?.send({ t: "catch", id });
        } else {
          soloCatches += res.caught.length;
          updateHud();
        }
      }
    }

    // 取り逃し → 被弾
    const exp = expireHearts(hearts, now);
    if (exp.missed.length > 0) {
      hearts = exp.remaining;
      for (const h of exp.missed) {
        damageSelf(h.kind, now, h.x);
        if (mode === "duo") session?.send({ t: "miss", id: h.id });
      }
      if (mode === "duo" && match.phase !== "playing") endMatch();
    }

    // ソロ練習: 定期スポーン(たまにチャージ弾・弾き返し弾も混ざる)
    if (mode === "solo" && now >= soloNextSpawnAt) {
      soloNextSpawnAt = now + 2000;
      soloHeartId++;
      const r = Math.random();
      const kind: HeartKind | undefined = r < 0.15 ? "special" : r < 0.3 ? "flick" : undefined;
      hearts = spawnHeart(hearts, soloHeartId, 0.1 + Math.random() * 0.8, now, kind);
    }
  } else if (!pinched) {
    pinchState = null;
  }

  // 左下メーター: チャージ弾の長押し進捗
  const charging = pinched && pinchState?.nearFace;
  meterFill.style.height = charging ? `${Math.min(1, (now - pinchState!.startedAt) / SPECIAL_HOLD_MS) * 100}%` : "0%";

  // 🤟弾き返しのクールダウン: 残り秒数をカウントダウン表示
  const reflectRemainMs = REFLECT_COOLDOWN_MS - (now - lastReflectAt);
  if (reflectRemainMs > 0 && Number.isFinite(reflectRemainMs)) {
    reflectCd.classList.add("cooling");
    reflectCdNum.textContent = String(Math.ceil(reflectRemainMs / 1000));
  } else {
    reflectCd.classList.remove("cooling");
    reflectCdNum.textContent = "";
  }

  effects = pruneEffects(effects, now);
  const skeletons: SkeletonHand[] = hand
    ? [
        {
          points: hand.landmarks.map(toStage),
          pinched,
          reflecting,
          open,
        },
      ]
    : [];
  drawFrame(canvas, hearts, skeletons, effects, now);
  requestAnimationFrame(loop);
}

function startLoop() {
  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(loop);
  }
}
function stopLoop() {
  loopRunning = false;
  playing = false;
}

// ---- 対戦フロー ----
function resetBattleState() {
  match = createMatch();
  hearts = [];
  effects = [];
  pinchState = null;
  lastPinchMidRaw = null;
  lastShotAt = -Infinity;
  lastSpecialAt = -Infinity;
  lastReflectAt = -Infinity;
  myRematch = false;
  theirRematch = false;
  soloCatches = 0;
  soloShots = 0;
  soloNextSpawnAt = 0;
  updateHud();
}

function beginCountdown() {
  resetBattleState();
  showScreen("battle");
  startLoop();
  playing = false;
  const startedAt = performance.now();
  countdownEl.classList.remove("hidden");
  countdownEl.textContent = countdownLabel(0);
  // 経過時間ベースで表示・開始を決める(メインスレッドが凍結しても開始タイミングがズレない)
  const timer = window.setInterval(() => {
    const label = countdownLabel(performance.now() - startedAt);
    if (label) {
      countdownEl.textContent = label;
    } else {
      clearInterval(timer);
      countdownEl.classList.add("hidden");
      playing = true;
    }
  }, 100);
}

function endMatch() {
  playing = false;
  const phase = match.phase;
  if (phase === "win") stats.wins++;
  else if (phase === "lose") stats.losses++;
  else if (phase === "draw") stats.draws++;
  saveStats();
  renderStatsLine();

  window.setTimeout(() => {
    stopLoop();
    const emoji = $("result-emoji");
    const title = $("result-title");
    const card = $("prompt-card");
    if (phase === "win") {
      emoji.textContent = "💘";
      title.textContent = "愛が届いた!";
      card.classList.add("hidden");
    } else if (phase === "lose") {
      emoji.textContent = "💔";
      title.textContent = "愛を受けとめきれなかった…";
      $("prompt-text").textContent = pickPrompt(seed, [...LOVE_PROMPTS]);
      card.classList.remove("hidden");
    } else {
      emoji.textContent = "💞";
      title.textContent = "相思相愛!";
      card.classList.add("hidden");
    }
    $("rematch-status").classList.add("hidden");
    showScreen("result");
  }, 900);
}

function maybeStartRematch() {
  if (!(myRematch && theirRematch) || !session) return;
  if (session.isHost) {
    seed = Math.floor(Math.random() * 1_000_000);
    session.send({ t: "start", seed });
    beginCountdown();
  }
  // ゲストはホストからの start を待つ
}

// ---- メッセージ処理 ----
function handleMsg(msg: Msg) {
  switch (msg.t) {
    case "hello":
      break;
    case "start":
      seed = msg.seed;
      beginCountdown();
      break;
    case "heart":
      // 開始前(カウントダウン中など)に届いたハートは破棄(開始直後の即被弾を防ぐ)
      if (!playing) break;
      hearts = spawnHeart(hearts, msg.id, msg.x, performance.now(), msg.kind);
      break;
    case "catch":
      // 相手が自分のハートを受けとめた
      effects.push({ kind: "catch", x: 0.5, y: 0.14, bornAt: performance.now() });
      break;
    case "miss":
      // 相手が取り逃した(自分のハートが刺さった)
      effects.push({ kind: "pop", x: 0.5, y: 0.12, bornAt: performance.now() });
      break;
    case "life":
      match = onOpponentLife(match, msg.mine);
      updateHud();
      if (match.phase !== "playing" && playing) endMatch();
      break;
    case "rematch":
      theirRematch = true;
      maybeStartRematch();
      break;
  }
}

const callbacks = {
  onMsg: handleMsg,
  onRemoteStream(stream: MediaStream) {
    remoteVideo.srcObject = stream;
    remoteVideo.play().catch(() => {});
  },
  onConnected() {
    // 開始処理は hostRoom/joinRoom の resolve 後に行う
  },
  onClosed() {
    if (!session) return;
    toast("相手との接続が切れました");
    cleanupSession();
    showScreen("top");
  },
};

function cleanupSession() {
  const s = session;
  session = null; // 先に外して close 起因の onClosed を無視させる
  s?.close();
  stopLoop();
  remoteVideo.srcObject = null;
  remoteVideo.classList.remove("mirror");
  selfVideo.classList.remove("hidden-window");
  releaseMedia();
  renderStatsLine();
}

// ---- 画面イベント ----
$("btn-host").addEventListener("click", async () => {
  mode = "duo";
  if (!(await ensureReady(true))) return;
  showScreen("lobby");
  $("lobby-status").textContent = "相手を待っています";
  try {
    session = await hostRoom(localStream!, callbacks, (room) => {
      $("room-code").textContent = room;
    });
    // 相手が接続してきたのでホストが開始を宣言
    seed = Math.floor(Math.random() * 1_000_000);
    session.send({ t: "start", seed });
    beginCountdown();
  } catch (e) {
    console.error(e);
    toast("ルームを作れませんでした。少し待ってもう一度お試しください");
    cleanupSession();
    showScreen("top");
  }
});

$("btn-copy").addEventListener("click", async () => {
  const room = $("room-code").textContent ?? "";
  const url = `${location.origin}${location.pathname}?room=${room}`;
  try {
    await navigator.clipboard.writeText(`ハートの撃ち合い、しませんか ♥ → ${url}`);
    toast("招待リンクをコピーしました。大切な人へどうぞ ♥");
  } catch {
    toast(`このURLを送ってください: ${url}`, 8000);
  }
});

$("form-join").addEventListener("submit", async (e) => {
  e.preventDefault();
  const room = normalizeRoom($<HTMLInputElement>("input-room").value);
  if (!isValidRoom(room)) {
    toast("合言葉は英字4文字です");
    return;
  }
  mode = "duo";
  if (!(await ensureReady(true))) return;
  setLoading("相手につないでいます…");
  try {
    session = await joinRoom(room, localStream!, callbacks);
    setLoading(null);
    // ホストからの start を待つ間、対戦画面でスタンバイ
    resetBattleState();
    showScreen("battle");
    startLoop();
  } catch (e) {
    setLoading(null);
    console.error(e);
    toast("ルームが見つかりませんでした。合言葉を確認してください");
  }
});

$("btn-solo").addEventListener("click", async () => {
  mode = "solo";
  if (!(await ensureReady(false))) return;
  remoteVideo.srcObject = localStream;
  remoteVideo.classList.add("mirror");
  remoteVideo.play().catch(() => {});
  selfVideo.classList.add("hidden-window");
  seed = Math.floor(Math.random() * 1_000_000);
  beginCountdown();
});

$("btn-lobby-back").addEventListener("click", () => {
  cleanupSession();
  showScreen("top");
});

$("btn-battle-exit").addEventListener("click", () => {
  cleanupSession();
  showScreen("top");
});

$("btn-rematch").addEventListener("click", () => {
  if (!session) return;
  myRematch = true;
  session.send({ t: "rematch" });
  $("rematch-status").classList.remove("hidden");
  maybeStartRematch();
});

$("btn-result-back").addEventListener("click", () => {
  cleanupSession();
  showScreen("top");
});

// ---- 起動 ----
(() => {
  renderStatsLine();
  const room = new URLSearchParams(location.search).get("room");
  if (room) {
    const input = $<HTMLInputElement>("input-room");
    input.value = room.toUpperCase();
    toast("合言葉を入力しました。「参加する」でつながります ♥");
  }
  showScreen("top");
})();
