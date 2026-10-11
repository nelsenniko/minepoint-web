
"use strict";

// ============================================
// MINEPOINT - FRONTEND APPLICATION
// Telegram Mini App + Node.js + SQLite
// ============================================

const API_BASE_URL = "https://ccd200e7173cd9.lhr.life";

const MINING_DURATION_MS = 12 * 60 * 60 * 1000;
const MINING_REWARD_PTS = 100;
const REFRESH_INTERVAL_MS = 15000;

const tg = window.Telegram?.WebApp ?? null;

let player = null;
let mining = null;
let loading = false;
let requestInProgress = false;
let refreshInterval = null;
let timerInterval = null;
let lastAutoClaimKey = null;

// ============================================
// DOM HELPERS
// ============================================

function byId(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

const elements = {
  playerName: byId("playerName"),
  profileStatus: byId("profileStatus"),
  connectionStatus: byId("connectionStatus"),
  balance: byId("balance"),
  miningTimer: byId("miningTimer"),
  miningStatus: byId("miningStatus"),
  startButton: byId(
    "startMiningBtn",
    "startMining",
    "mineButton",
    "btnStartMining"
  ),
  claimButton: byId(
    "claimRewardBtn",
    "claimReward",
    "claimButton",
    "btnClaimReward"
  ),
  message: byId("message", "appMessage", "statusMessage")
};

function setText(element, value) {
  if (element) element.textContent = String(value ?? "");
}

function showMessage(message, type = "info") {
  const target = elements.message;

  if (target) {
    target.textContent = message;
    target.dataset.type = type;
    target.classList.remove(
      "success",
      "error",
      "warning",
      "info"
    );
    target.classList.add(type);
    target.hidden = false;
    return;
  }

  console[type === "error" ? "error" : "log"](
    `[MinePoint/${type}] ${message}`
  );
}

function clearMessage() {
  if (!elements.message) return;

  elements.message.textContent = "";
  elements.message.hidden = true;
  elements.message.classList.remove(
    "success",
    "error",
    "warning",
    "info"
  );
}

function setButton(button, label, disabled) {
  if (!button) return;

  button.textContent = label;
  button.disabled = Boolean(disabled);
}

function formatPTS(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.floor(number).toLocaleString("id-ID")
    : "0";
}

// ============================================
// TELEGRAM
// ============================================

function isTelegramAuthenticated() {
  return Boolean(
    tg &&
    typeof tg.initData === "string" &&
    tg.initData.length > 0
  );
}

function initTelegram() {
  if (!tg) {
    setText(
      elements.profileStatus,
      "Buka melalui Telegram"
    );

    setText(
      elements.connectionStatus,
      "Menunggu Telegram"
    );

    return;
  }

  try {
    tg.ready();
    tg.expand();
  } catch (error) {
    console.warn("Telegram WebApp initialization:", error);
  }

  if (!isTelegramAuthenticated()) {
    setText(
      elements.profileStatus,
      "Autentikasi Telegram belum tersedia"
    );

    setText(
      elements.connectionStatus,
      "Buka melalui tombol Open App di bot"
    );
  }
}

// ============================================
// API REQUEST
// ============================================

async function apiRequest(path, options = {}) {
  if (!isTelegramAuthenticated()) {
    throw new Error(
      "Data autentikasi Telegram tidak tersedia. " +
      "Buka MinePoint melalui tombol Open App di Telegram."
    );
  }

  const headers = {
    Accept: "application/json",
    "X-Telegram-Init-Data": tg.initData,
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    console.error("MinePoint network error:", error);

    throw new Error(
      "Koneksi ke server gagal. Periksa tunnel, " +
      "jaringan internet, dan URL API."
    );
  }

  const responseText = await response.text();
  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {
      message: responseText || "Respons server tidak valid."
    };
  }

  if (!response.ok) {
    console.error("MinePoint API error:", {
      path,
      status: response.status,
      response: data
    });

    if (response.status === 401) {
      throw new Error(
        data.error ||
        "Autentikasi Telegram ditolak. Tutup Mini App, " +
        "lalu buka kembali melalui bot."
      );
    }

    if (response.status === 403) {
      throw new Error(
        data.error || "Akses ke fitur ini ditolak."
      );
    }

    if (response.status === 404) {
      throw new Error(
        data.error ||
        `Endpoint ${path} tidak ditemukan di server.`
      );
    }

    throw new Error(
      data.error ||
      data.message ||
      `Server mengembalikan HTTP ${response.status}.`
    );
  }

  return data;
}

// ============================================
// NORMALISASI RESPONS API
// ============================================

function getPlayer(data) {
  if (!data || typeof data !== "object") {
    return {};
  }

  return (
    data.player ||
    data.user ||
    data.profile ||
    data
  );
}

function getMiningSession(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const session =
    data.mining ||
    data.miningSession ||
    data.mining_session ||
    data.session ||
    data.activeMining ||
    null;

  if (session && typeof session === "object") {
    return session;
  }

  // Mendukung respons API yang meletakkan status
  // mining langsung di objek utama.
  if (
    data.started_at ||
    data.startedAt ||
    data.ends_at ||
    data.endsAt ||
    data.end_time ||
    data.endTime
  ) {
    return data;
  }

  return null;
}

function getBalance(data) {
  const p = getPlayer(data);

  const candidates = [
    data?.balance,
    data?.balance_pts,
    data?.pts,
    data?.points,
    p?.balance,
    p?.balance_pts,
    p?.pts,
    p?.points
  ];

  for (const value of candidates) {
    if (value !== undefined && value !== null) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }

  return 0;
}

// ============================================
// PROFIL
// ============================================

function updateProfile() {
  const telegramUser = tg?.initDataUnsafe?.user || {};

  const name =
    player?.username ||
    player?.first_name ||
    player?.firstName ||
    player?.name ||
    telegramUser.username ||
    telegramUser.first_name ||
    "Pemain MinePoint";

  setText(elements.playerName, name);

  if (isTelegramAuthenticated()) {
    setText(elements.profileStatus, "Telegram terverifikasi");
    setText(elements.connectionStatus, "Terhubung");
  }
}

function updateBalance(data) {
  const balance = getBalance(data);

  setText(elements.balance, formatPTS(balance));
}

// ============================================
// WAKTU MINING
// ============================================

function getTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    // Mendukung timestamp detik maupun milidetik.
    return value < 100000000000
      ? value * 1000
      : value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);

    if (Number.isFinite(numeric) && value.trim() !== "") {
      return numeric < 100000000000
        ? numeric * 1000
        : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getEndsAt(session) {
  if (!session) return null;

  const directValues = [
    session.ends_at,
    session.endsAt,
    session.end_time,
    session.endTime,
    session.finish_at,
    session.finishAt,
    session.completed_at
  ];

  for (const value of directValues) {
    const timestamp = getTimestamp(value);
    if (timestamp !== null) return timestamp;
  }

  const startValues = [
    session.started_at,
    session.startedAt,
    session.start_time,
    session.startTime,
    session.created_at,
    session.createdAt
  ];

  for (const value of startValues) {
    const timestamp = getTimestamp(value);

    if (timestamp !== null) {
      return timestamp + MINING_DURATION_MS;
    }
  }

  return null;
}

function isMiningActive(session) {
  if (!session) return false;

  if (
    session.active === false ||
    session.is_active === false ||
    session.isActive === false ||
    session.status === "completed" ||
    session.status === "claimed" ||
    session.status === "cancelled"
  ) {
    return false;
  }

  const endsAt = getEndsAt(session);

  if (endsAt !== null) {
    return endsAt > Date.now();
  }

  return Boolean(
    session.active ||
    session.is_active ||
    session.isActive ||
    session.status === "active" ||
    session.status === "mining"
  );
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1000)
  );

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}

// ============================================
// TAMPILAN MINING
// ============================================

function renderMining() {
  const active = isMiningActive(mining);
  const endsAt = getEndsAt(mining);

  if (active && endsAt !== null) {
    setText(
      elements.miningTimer,
      formatRemaining(endsAt - Date.now())
    );

    setText(
      elements.miningStatus,
      "Mining sedang berlangsung"
    );

    setButton(
      elements.startButton,
      "Mining Berlangsung",
      true
    );

    setButton(
      elements.claimButton,
      "Klaim Reward",
      true
    );

    if (elements.claimButton) {
      elements.claimButton.disabled = true;
    }

    return;
  }

  const claimable = Boolean(
    mining &&
    (
      mining.claimable === true ||
      mining.can_claim === true ||
      mining.canClaim === true ||
      mining.status === "completed"
    )
  );

  if (claimable) {
    setText(elements.miningTimer, "00:00:00");
    setText(elements.miningStatus, "Reward siap diklaim");

    setButton(
      elements.startButton,
      "Mulai Mining",
      loading
    );

    setButton(
      elements.claimButton,
      "Klaim Reward",
      loading
    );

    if (elements.claimButton) {
      elements.claimButton.disabled = loading;
    }

    return;
  }

  setText(elements.miningTimer, "12:00:00");
  setText(elements.miningStatus, "Siap untuk mining");

  setButton(
    elements.startButton,
    loading ? "Memproses..." : "Mulai Mining",
    loading
  );

  setButton(
    elements.claimButton,
    "Klaim Reward",
    true
  );
}

// ============================================
// MUAT STATUS PEMAIN
// ============================================

async function refreshStatus() {
  if (requestInProgress) return;

  if (!isTelegramAuthenticated()) {
    setText(elements.profileStatus, "Menunggu autentikasi");
    setText(elements.connectionStatus, "Buka melalui Telegram");

    showMessage(
      "Buka MinePoint melalui tombol Open App di Telegram.",
      "warning"
    );

    return;
  }

  requestInProgress = true;

  try {
    const data = await apiRequest("/api/me");

    player = getPlayer(data);
    mining = getMiningSession(data);

    updateProfile();
    updateBalance(data);
    renderMining();

    clearMessage();

    if (elements.connectionStatus) {
      elements.connectionStatus.textContent = "Terhubung";
    }
  } catch (error) {
    console.error("refreshStatus:", error);

    setText(elements.profileStatus, "Gagal memuat profil");

    if (elements.connectionStatus) {
      elements.connectionStatus.textContent = "Periksa status";
    }

    showMessage(
      error.message || "Gagal memuat status pemain.",
      "error"
    );
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

  if (isMiningActive(mining)) {
    showMessage(
      "Sesi mining masih berlangsung.",
      "warning"
    );
    return;
  }

  loading = true;
  setButton(elements.startButton, "Memulai mining...", true);
  setButton(elements.claimButton, "Klaim Reward", true);
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
    console.error("startMining:", error);
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

  loading = true;
  setButton(elements.claimButton, "Mengklaim reward...", true);
  setButton(elements.startButton, "Memproses...", true);
  clearMessage();

  try {
    const result = await apiRequest("/api/mine/claim", {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(
      result.message || "Permintaan klaim berhasil diproses.",
      "success"
    );

    await refreshStatus();
  } catch (error) {
    console.error("claimReward:", error);
    showMessage(error.message, "error");
    await refreshStatus();
  } finally {
    loading = false;
    renderMining();
  }
}

// ============================================
// EVENT BUTTONS
// ============================================

function findButtonByText(pattern) {
  return Array.from(document.querySelectorAll("button"))
    .find(button => pattern.test(button.textContent || ""));
}

function setupMiningButtons() {
  if (!elements.startButton) {
    elements.startButton = findButtonByText(
      /mulai mining|start mining/i
    );
  }

  if (!elements.claimButton) {
    elements.claimButton = findButtonByText(
      /klaim reward|claim reward/i
    );
  }

  if (elements.startButton) {
    elements.startButton.addEventListener("click", event => {
      event.preventDefault();
      startMining();
    });
  } else {
    console.error(
      "Tombol Mulai Mining tidak ditemukan. Periksa ID tombol di index.html."
    );
  }

  if (elements.claimButton) {
    elements.claimButton.addEventListener("click", event => {
      event.preventDefault();
      claimReward();
    });
  }
}

// ============================================
// TIMER
// ============================================

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    if (!mining) return;

    const endsAt = getEndsAt(mining);

    if (endsAt === null) {
      return;
    }

    if (endsAt <= Date.now()) {
      setText(elements.miningTimer, "00:00:00");
      setText(elements.miningStatus, "Memeriksa reward...");

      // Jangan mengeklaim reward berulang kali.
      const claimKey = String(endsAt);

      if (lastAutoClaimKey !== claimKey) {
        lastAutoClaimKey = claimKey;
        refreshStatus();
      }

      return;
    }

    if (isMiningActive(mining)) {
      setText(
        elements.miningTimer,
        formatRemaining(endsAt - Date.now())
      );
    }
  }, 1000);
}

// ============================================
// NAVIGASI SEDERHANA
// ============================================

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.page;

      document.querySelectorAll("[data-page]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll("[data-page-content]").forEach(page => {
        page.hidden = page.dataset.pageContent !== target;
      });
    });
  });
}

// ============================================
// START APPLICATION
// ============================================

async function initApp() {
  initTelegram();
  setupNavigation();
  setupMiningButtons();
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
  document.addEventListener("DOMContentLoaded", initApp, {
    once: true
  });
} else {
  initApp();
}

// ============================================
// DEBUGGING TANPA MEMBOCORKAN DATA TELEGRAM
// ============================================

window.MinePointDebug = Object.freeze({
  getStatus() {
    return {
      telegramWebAppAvailable: Boolean(tg),
      initDataAvailable: isTelegramAuthenticated(),
      apiBaseConfigured: Boolean(API_BASE_URL),
      playerLoaded: Boolean(player),
      miningLoaded: Boolean(mining)
    };
  },

  refresh() {
    return refreshStatus();
  }
});
