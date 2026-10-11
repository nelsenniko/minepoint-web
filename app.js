
"use strict";

// Ganti URL ini setiap kali alamat tunnel berubah.
const API_BASE_URL = "https://a114588aa923be.lhr.life";

const DURATION_MS = 12 * 60 * 60 * 1000;
const REFRESH_MS = 15000;

const tg = window.Telegram?.WebApp ?? null;

const $ = id => document.getElementById(id);

const ui = {
  name: $("playerName"),
  connection: $("connectionStatus"),
  balance: $("balance"),
  timer: $("miningTimer"),
  status: $("miningStatus"),
  start: $("startButton"),
  claim: $("claimButton"),
  message: $("message")
};

let player = null;
let mining = null;
let busy = false;
let refreshing = false;
let refreshTimer = null;

// ------------------------------------
// PESAN
// ------------------------------------

function message(text, type = "info") {
  ui.message.textContent = text;
  ui.message.className = `message ${type}`;
  ui.message.hidden = false;
}

function clearMessage() {
  ui.message.textContent = "";
  ui.message.hidden = true;
}

function telegramReady() {
  return Boolean(tg?.initData);
}

// ------------------------------------
// API
// ------------------------------------

async function api(path, options = {}) {
  if (!telegramReady()) {
    throw new Error(
      "Buka MinePoint melalui tombol Open App di Telegram."
    );
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {}),
        "X-Telegram-Init-Data": tg.initData
      }
    });
  } catch (error) {
    console.error("MinePoint network error:", error);
    throw new Error(
      "Koneksi gagal. Periksa server, tunnel, dan internet."
    );
  }

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Server error: HTTP ${response.status}`
    );
  }

  return data;
}

// ------------------------------------
// DATA PEMAIN
// ------------------------------------

function getPlayer(data) {
  return data?.player ||
    data?.user ||
    data?.profile ||
    data;
}

function getMining(data) {
  return data?.mining ||
    data?.miningSession ||
    data?.mining_session ||
    data?.session ||
    null;
}

function getBalance(data) {
  const p = getPlayer(data);

  for (const value of [
    data?.balance,
    data?.balance_pts,
    data?.pts,
    data?.points,
    p?.balance,
    p?.balance_pts,
    p?.pts,
    p?.points
  ]) {
    if (value !== undefined && value !== null) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }

  return 0;
}

function timestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" ||
      /^\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    return number < 1e11 ? number * 1000 : number;
  }

  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function endsAt(session) {
  if (!session) return null;

  for (const value of [
    session.ends_at,
    session.endsAt,
    session.end_time,
    session.endTime,
    session.finish_at,
    session.finishAt
  ]) {
    const result = timestamp(value);
    if (result !== null) return result;
  }

  for (const value of [
    session.started_at,
    session.startedAt,
    session.start_time,
    session.startTime,
    session.created_at,
    session.createdAt
  ]) {
    const result = timestamp(value);
    if (result !== null) return result + DURATION_MS;
  }

  return null;
}

function isActive(session) {
  if (!session) return false;

  if (
    session.active === false ||
    session.is_active === false ||
    session.isActive === false ||
    ["completed", "claimed", "cancelled"].includes(session.status)
  ) {
    return false;
  }

  const end = endsAt(session);

  if (end !== null) return end > Date.now();

  return Boolean(
    session.active ||
    session.is_active ||
    session.isActive ||
    session.status === "active" ||
    session.status === "mining"
  );
}

function canClaim(session) {
  if (!session) return false;

  if (
    session.claimable === true ||
    session.can_claim === true ||
    session.canClaim === true ||
    session.status === "completed"
  ) {
    return true;
  }

  const end = endsAt(session);
  return end !== null && end <= Date.now() && !isActive(session);
}

// ------------------------------------
// TAMPILAN
// ------------------------------------

function render() {
  const telegramUser = tg?.initDataUnsafe?.user || {};

  ui.name.textContent =
    player?.username ||
    player?.first_name ||
    player?.firstName ||
    player?.name ||
    telegramUser.username ||
    telegramUser.first_name ||
    "Pemain MinePoint";

  ui.balance.textContent = getBalance({ player }).toLocaleString("id-ID");

  const end = endsAt(mining);
  const active = isActive(mining);
  const claimable = canClaim(mining);

  if (active && end !== null) {
    ui.timer.textContent = formatTime(end - Date.now());
    ui.status.textContent = "Penambangan sedang berlangsung";
  } else if (claimable) {
    ui.timer.textContent = "00:00:00";
    ui.status.textContent = "Reward siap diklaim";
  } else {
    ui.timer.textContent = "12:00:00";
    ui.status.textContent = "Siap untuk penambangan";
  }

  ui.start.disabled = busy || active || claimable;
  ui.start.textContent = active
    ? "Penambangan Berlangsung"
    : "Mulai Mining";

  ui.claim.disabled = busy || !claimable;
  ui.claim.textContent = "Klaim Reward";
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return [h, m, s]
    .map(n => String(n).padStart(2, "0"))
    .join(":");
}

// ------------------------------------
// MUAT DATA
// ------------------------------------

async function refreshStatus() {
  if (refreshing) return;

  if (!telegramReady()) {
    ui.name.textContent = "Buka melalui Telegram";
    ui.connection.textContent = "Autentikasi belum tersedia";
    ui.start.disabled = true;
    ui.claim.disabled = true;

    message(
      "Gunakan tombol Open App di MinePointGameBot.",
      "warning"
    );
    return;
  }

  refreshing = true;

  try {
    const data = await api("/api/me");

    player = getPlayer(data);
    mining = getMining(data);

    ui.connection.textContent = "Terhubung";
    render();
    clearMessage();
  } catch (error) {
    console.error("refreshStatus:", error);

    ui.connection.textContent = "Koneksi bermasalah";
    message(error.message, "error");
  } finally {
    refreshing = false;
  }
}

// ------------------------------------
// MULAI MINING
// ------------------------------------

async function startMining() {
  if (busy) return;

  busy = true;
  ui.start.disabled = true;
  clearMessage();

  try {
    await api("/api/mine/start", {
      method: "POST",
      body: JSON.stringify({})
    });

    message("Permintaan mining berhasil.", "success");
    await refreshStatus();
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}

// ------------------------------------
// KLAIM REWARD
// ------------------------------------

async function claimReward() {
  if (busy) return;

  busy = true;
  ui.claim.disabled = true;
  clearMessage();

  try {
    await api("/api/mine/claim", {
      method: "POST",
      body: JSON.stringify({})
    });

    message("Klaim reward berhasil diproses.", "success");
    await refreshStatus();
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}

// ------------------------------------
// TIMER
// ------------------------------------

function tick() {
  if (!mining) return;

  const end = endsAt(mining);

  if (end !== null && isActive(mining)) {
    ui.timer.textContent = formatTime(end - Date.now());

    if (end <= Date.now()) {
      refreshStatus();
    }
  }
}

// ------------------------------------
// START
// ------------------------------------

function init() {
  if (tg) {
    tg.ready();
    tg.expand();
  }

  ui.start.addEventListener("click", startMining);
  ui.claim.addEventListener("click", claimReward);

  refreshStatus();

  if (refreshTimer) clearInterval(refreshTimer);

  refreshTimer = setInterval(refreshStatus, REFRESH_MS);
  setInterval(tick, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
