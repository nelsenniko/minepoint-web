
"use strict";

// ============================================
// MINEPOINT V1
// Frontend: HTML + CSS + JavaScript
// Backend: Node.js + Express + SQLite
// ============================================

const API_BASE_URL = "https://1bcb2ca2a17518.lhr.life";

const MINING_DURATION_MS = 12 * 60 * 60 * 1000;
const MINING_REWARD_PTS = 100;
const REFRESH_INTERVAL_MS = 15000;

const tg = window.Telegram?.WebApp;

const elements = {
  profileName: document.getElementById("profileName"),
  profileConnection: document.getElementById("profileConnection"),
  profileConnectionMirror: document.getElementById("profileConnectionMirror"),
  profileId: document.getElementById("profileId"),
  profileStatus: document.getElementById("profileStatus"),

  walletBalance: document.getElementById("walletBalance"),
  walletBalanceMirror: document.getElementById("walletBalanceMirror"),
  walletStatus: document.getElementById("walletStatus"),

  miningTimer: document.getElementById("miningTimer"),
  miningStatus: document.getElementById("miningStatus"),
  miningActionBtn: document.getElementById("miningActionBtn"),
  progressBar: document.getElementById("progressBar"),
  progressPercent: document.getElementById("progressPercent"),
  progressTrack: document.getElementById("progressTrack"),

  message: document.getElementById("message")
};

let player = null;
let mining = null;
let loading = false;
let timerInterval = null;
let refreshInterval = null;
let requestInProgress = false;

// ============================================
// UTILITAS UI
// ============================================

function showMessage(message, type = "info") {
  if (!elements.message) return;

  elements.message.textContent = message;
  elements.message.dataset.type = type;
  elements.message.hidden = false;
}

function clearMessage() {
  if (!elements.message) return;

  elements.message.textContent = "";
  elements.message.hidden = true;
  delete elements.message.dataset.type;
}

function setButton(text, disabled = false) {
  if (!elements.miningActionBtn) return;

  elements.miningActionBtn.textContent = text;
  elements.miningActionBtn.disabled = disabled;
}

function formatNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString("id-ID")
    : "0";
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(milliseconds / 1000)
  );

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

// ============================================
// NORMALISASI DATA BACKEND
// ============================================

function getEndsAt(session) {
  if (!session) return null;

  const value =
    session.endsAt ??
    session.ends_at ??
    session.endTime ??
    session.end_time ??
    session.endAt ??
    session.end_at;

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

function getPlayer(data) {
  return data?.player ?? data?.user ?? data?.account ?? data;
}

function getBalance(data) {
  const sources = [
    data?.player,
    data?.user,
    data?.account,
    data
  ];

  for (const source of sources) {
    if (!source) continue;

    const value =
      source.balance ??
      source.points ??
      source.pts_balance ??
      source.ptsBalance;

    if (value !== undefined && value !== null) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
  }

  return 0;
}

function getMiningSession(data) {
  if (!data) return null;

  const candidates = [
    data.mining,
    data.activeMining,
    data.active_mining,
    data.session,
    data.miningSession,
    data.mining_session,
    data.activeSession,
    data.active_session
  ];

  const session = candidates.find(
    item => item && typeof item === "object"
  );

  if (!session) return null;

  const status = String(
    session.status ?? ""
  ).toLowerCase();

  if (
    session.active === false ||
    session.isActive === false ||
    session.is_active === false ||
    ["claimed", "completed", "cancelled", "canceled"].includes(status)
  ) {
    return null;
  }

  return session;
}

function isTelegramAuthenticated() {
  return Boolean(tg?.initData);
}

// ============================================
// API REQUEST
// ============================================

async function apiRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (isTelegramAuthenticated()) {
    headers["X-Telegram-Init-Data"] = tg.initData;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    throw new Error(
      "Tidak dapat terhubung ke server. Periksa server dan tunnel."
    );
  }

  const responseText = await response.text();

  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {
      message: responseText
    };
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Permintaan gagal: HTTP ${response.status}`
    );
  }

  return data;
}

// ============================================
// PROFIL
// ============================================

function updateProfile() {
  const telegramUser = tg?.initDataUnsafe?.user;

  const name =
    player?.username ||
    player?.first_name ||
    player?.firstName ||
    telegramUser?.username ||
    telegramUser?.first_name ||
    "Pemain MinePoint";

  const telegramId =
    player?.telegramId ??
    player?.telegram_id ??
    player?.telegramUserId ??
    player?.telegram_user_id ??
    telegramUser?.id;

  if (elements.profileName) {
    elements.profileName.textContent = name;
  }

  if (elements.profileId) {
    elements.profileId.textContent =
      telegramId !== undefined && telegramId !== null
        ? String(telegramId)
        : "-";
  }

  const connectionText = isTelegramAuthenticated()
    ? "Telegram WebApp"
    : "Mode browser";

  if (elements.profileConnection) {
    elements.profileConnection.textContent = connectionText;
  }

  if (elements.profileConnectionMirror) {
    elements.profileConnectionMirror.textContent = connectionText;
  }

  if (elements.profileStatus) {
    elements.profileStatus.textContent = player
      ? "Data akun berhasil dimuat"
      : "Menunggu autentikasi";
  }

  if (elements.walletStatus) {
    elements.walletStatus.textContent =
      "PTS adalah poin internal permainan.";
  }
}

// ============================================
// SALDO
// ============================================

function updateBalance(data) {
  const balance = formatNumber(getBalance(data));

  if (elements.walletBalance) {
    elements.walletBalance.textContent = balance;
  }

  if (elements.walletBalanceMirror) {
    elements.walletBalanceMirror.textContent = balance;
  }
}

// ============================================
// PROGRES DAN TIMER MINING
// ============================================

function updateProgress(progress) {
  const safeProgress = Math.min(
    100,
    Math.max(0, progress)
  );

  const roundedProgress = Math.floor(safeProgress);

  if (elements.progressBar) {
    elements.progressBar.style.width =
      `${safeProgress}%`;
  }

  if (elements.progressPercent) {
    elements.progressPercent.textContent =
      `${roundedProgress}%`;
  }

  if (elements.progressTrack) {
    elements.progressTrack.setAttribute(
      "aria-valuenow",
      String(roundedProgress)
    );
  }
}

function renderMining() {
  if (!elements.miningTimer || !elements.miningStatus) {
    return;
  }

  if (!mining) {
    elements.miningTimer.textContent = "12:00:00";

    elements.miningStatus.textContent =
      "Siap memulai mining selama 12 jam.";

    updateProgress(0);

    setButton(
      "Mulai Mining",
      loading || !isTelegramAuthenticated()
    );

    return;
  }

  const endsAt = getEndsAt(mining);

  if (!endsAt) {
    elements.miningTimer.textContent = "--:--:--";

    elements.miningStatus.textContent =
      "Waktu sesi tidak valid. Periksa respons backend.";

    updateProgress(0);
    setButton("Periksa Status", loading);

    return;
  }

  const startedAt =
    mining.startedAt ??
    mining.started_at ??
    mining.startTime ??
    mining.start_time;

  let startTime = startedAt
    ? (typeof startedAt === "number"
        ? (startedAt < 1e12 ? startedAt * 1000 : startedAt)
        : Date.parse(startedAt))
    : endsAt - MINING_DURATION_MS;

  if (!Number.isFinite(startTime) || startTime >= endsAt) {
    startTime = endsAt - MINING_DURATION_MS;
  }

  const totalDuration = Math.max(
    1,
    endsAt - startTime
  );

  const remaining = Math.max(
    0,
    endsAt - Date.now()
  );

  const progress =
    ((totalDuration - remaining) / totalDuration) * 100;

  updateProgress(progress);

  if (remaining <= 0) {
    elements.miningTimer.textContent = "00:00:00";

    elements.miningStatus.textContent =
      `Mining selesai. Reward ${MINING_REWARD_PTS} PTS siap diklaim.`;

    setButton(
      "Klaim Reward",
      loading || !isTelegramAuthenticated()
    );

    return;
  }

  elements.miningTimer.textContent =
    formatTime(remaining);

  elements.miningStatus.textContent =
    `Mining berjalan. Reward ${MINING_REWARD_PTS} PTS.`;

  setButton("Mining Berjalan", true);
}

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    renderMining();
  }, 1000);
}

// ============================================
// MUAT STATUS PEMAIN
// ============================================

async function refreshStatus() {
  if (requestInProgress) return;

  requestInProgress = true;

  try {
    const data = await apiRequest("/api/me");

    player = getPlayer(data);
    mining = getMiningSession(data);

    updateProfile();
    updateBalance(data);
    renderMining();

    if (!isTelegramAuthenticated()) {
      showMessage(
        "Buka MinePoint melalui tombol aplikasi di Telegram untuk autentikasi.",
        "warning"
      );
    } else {
      clearMessage();
    }
  } catch (error) {
    if (elements.profileStatus) {
      elements.profileStatus.textContent =
        "Koneksi gagal";
    }

    showMessage(error.message, "error");
  } finally {
    requestInProgress = false;
  }
}

// ============================================
// MULAI MINING
// ============================================

async function startMining() {
  if (loading) return;

  if (!isTelegramAuthenticated()) {
    showMessage(
      "Buka aplikasi melalui Telegram agar akun dapat diverifikasi.",
      "warning"
    );
    return;
  }

  if (mining) {
    showMessage(
      "Kamu masih memiliki sesi mining aktif.",
      "warning"
    );
    return;
  }

  loading = true;
  setButton("Memulai mining...", true);
  clearMessage();

  try {
    await apiRequest("/api/mine/start", {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(
      "Permintaan mining berhasil diproses.",
      "success"
    );

    await refreshStatus();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    loading = false;
    renderMining();
  }
}

// ============================================
// KLAIM REWARD
// ============================================

async function claimReward() {
  if (loading) return;

  if (!isTelegramAuthenticated()) {
    showMessage(
      "Autentikasi Telegram diperlukan untuk klaim reward.",
      "warning"
    );
    return;
  }

  if (!mining) {
    showMessage(
      "Tidak ada sesi mining untuk diklaim.",
      "warning"
    );
    return;
  }

  const endsAt = getEndsAt(mining);

  if (!endsAt) {
    showMessage(
      "Waktu selesai mining tidak valid. Periksa data backend.",
      "error"
    );
    return;
  }

  if (Date.now() < endsAt) {
    showMessage(
      "Mining belum selesai. Tunggu sampai timer mencapai nol.",
      "warning"
    );
    return;
  }

  loading = true;
  setButton("Mengklaim reward...", true);
  clearMessage();

  try {
    await apiRequest("/api/mine/claim", {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(
      `Permintaan klaim ${MINING_REWARD_PTS} PTS berhasil diproses.`,
      "success"
    );

    await refreshStatus();
  } catch (error) {
    showMessage(error.message, "error");

    await refreshStatus();
  } finally {
    loading = false;
    renderMining();
  }
}

// ============================================
// NAVIGASI BAWAH
// ============================================

function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetId = item.dataset.tab;

      const targetPage = document.getElementById(targetId);

      if (!targetPage) {
        console.error(
          `Halaman navigasi tidak ditemukan: ${targetId}`
        );
        return;
      }

      navItems.forEach(nav => {
        const active = nav === item;

        nav.classList.toggle("active", active);
        nav.setAttribute(
          "aria-current",
          active ? "page" : "false"
        );
      });

      pages.forEach(page => {
        page.classList.toggle(
          "active",
          page.id === targetId
        );
      });

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  });
}

// ============================================
// TOMBOL MINING DINAMIS
// ============================================

function setupMiningButton() {
  if (!elements.miningActionBtn) return;

  elements.miningActionBtn.addEventListener("click", () => {
    if (loading) return;

    if (!isTelegramAuthenticated()) {
      showMessage(
        "Buka MinePoint dari Telegram untuk memulai mining.",
        "warning"
      );
      return;
    }

    if (!mining) {
      startMining();
      return;
    }

    const endsAt = getEndsAt(mining);

    if (!endsAt) {
      refreshStatus();
      return;
    }

    if (Date.now() >= endsAt) {
      claimReward();
    } else {
      showMessage(
        "Sesi mining masih berlangsung.",
        "info"
      );
    }
  });
}

// ============================================
// INISIALISASI
// ============================================

async function init() {
  if (tg) {
    tg.ready();
    tg.expand();
  }

  setupNavigation();
  setupMiningButton();
  startTimer();

  await refreshStatus();

  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  refreshInterval = setInterval(() => {
    refreshStatus();
  }, REFRESH_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
}
