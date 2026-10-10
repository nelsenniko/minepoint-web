
const API_BASE_URL = "https://edea5b3641e93e.lhr.life";

const MINING_DURATION_MS = 12 * 60 * 60 * 1000;
const MINING_REWARD_PTS = 100;
const REFRESH_INTERVAL_MS = 15000;

const tg = window.Telegram?.WebApp;

const elements = {
  profileName: document.getElementById("profileName"),
  profileConnection: document.getElementById("profileConnection"),
  profileId: document.getElementById("profileId"),
  profileStatus: document.getElementById("profileStatus"),

  walletBalance: document.getElementById("walletBalance"),
  walletStatus: document.getElementById("walletStatus"),

  miningTimer: document.getElementById("miningTimer"),
  miningStatus: document.getElementById("miningStatus"),
  miningActionBtn: document.getElementById("miningActionBtn"),
  progressBar: document.getElementById("progressBar"),
  progressPercent: document.getElementById("progressPercent"),

  message: document.getElementById("message")
};

let player = null;
let mining = null;
let loading = false;
let timerInterval = null;
let refreshInterval = null;

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
}

function setButton(text, disabled = false) {
  if (!elements.miningActionBtn) return;

  elements.miningActionBtn.textContent = text;
  elements.miningActionBtn.disabled = disabled;
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

function getEndsAt(session) {
  if (!session) return null;

  const value =
    session.endsAt ??
    session.ends_at ??
    session.endTime ??
    session.end_time;

  if (value === undefined || value === null) return null;

  if (typeof value === "number") {
    // Mendukung timestamp dalam detik atau milidetik.
    return value < 1e12 ? value * 1000 : value;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

function getMiningSession(data) {
  if (!data) return null;

  const session =
    data.mining ??
    data.activeMining ??
    data.active_mining ??
    data.session ??
    data.miningSession ??
    data.mining_session;

  if (!session || typeof session !== "object") return null;

  const active =
    session.active ??
    session.isActive ??
    session.is_active;

  const status = String(session.status ?? "").toLowerCase();

  if (
    active === false ||
    ["claimed", "completed", "cancelled", "canceled"].includes(status)
  ) {
    return null;
  }

  return session;
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (tg?.initData) {
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
      "Gagal terhubung ke server. Periksa apakah tunnel masih aktif."
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
      return Number(value) || 0;
    }
  }

  return 0;
}

function getPlayer(data) {
  return data?.player ?? data?.user ?? data?.account ?? data;
}

function updateProfile() {
  const telegramUser = tg?.initDataUnsafe?.user;

  const name =
    player?.username ||
    player?.first_name ||
    player?.firstName ||
    telegramUser?.username ||
    telegramUser?.first_name ||
    "Pemain MinePoint";

  if (elements.profileName) {
    elements.profileName.textContent = name;
  }

  const id =
    player?.telegramId ??
    player?.telegram_id ??
    player?.telegramUserId ??
    player?.telegram_user_id ??
    telegramUser?.id;

  if (elements.profileId) {
    elements.profileId.textContent = id ? String(id) : "-";
  }

  if (elements.profileConnection) {
    elements.profileConnection.textContent =
      tg?.initData ? "Telegram WebApp" : "Mode browser";
  }

  if (elements.profileStatus) {
    elements.profileStatus.textContent =
      player ? "Terhubung ke server" : "Belum terautentikasi";
  }

  if (elements.walletStatus) {
    elements.walletStatus.textContent =
      "PTS adalah poin internal permainan.";
  }
}

function updateBalance(data) {
  if (!elements.walletBalance) return;

  elements.walletBalance.textContent =
    getBalance(data).toLocaleString("id-ID");
}

function updateProgress(remainingMs) {
  if (!elements.progressBar || !elements.progressPercent) return;

  const remaining = Math.max(0, remainingMs);
  const progress = Math.min(
    100,
    Math.max(
      0,
      ((MINING_DURATION_MS - remaining) / MINING_DURATION_MS) * 100
    )
  );

  elements.progressBar.style.width = `${progress}%`;
  elements.progressPercent.textContent = `${Math.floor(progress)}%`;
}

function renderMining() {
  if (!elements.miningTimer || !elements.miningStatus) return;

  if (!mining) {
    elements.miningTimer.textContent = "12:00:00";
    elements.miningStatus.textContent =
      "Siap memulai mining selama 12 jam.";
    updateProgress(0);
    setButton("Mulai Mining", loading);
    return;
  }

  const endsAt = getEndsAt(mining);

  if (!endsAt) {
    elements.miningTimer.textContent = "--:--:--";
    elements.miningStatus.textContent =
      "Sesi ditemukan, tetapi waktu selesai tidak valid.";
    setButton("Periksa Status", loading);
    return;
  }

  const remaining = endsAt - Date.now();

  if (remaining <= 0) {
    elements.miningTimer.textContent = "00:00:00";
    elements.miningStatus.textContent =
      `Mining selesai. Reward ${MINING_REWARD_PTS} PTS siap diklaim.`;
    updateProgress(0);
    setButton("Klaim Reward", loading);
    return;
  }

  elements.miningTimer.textContent = formatTime(remaining);
  elements.miningStatus.textContent =
    `Mining berjalan. Reward ${MINING_REWARD_PTS} PTS.`;

  updateProgress(remaining);
  setButton("Mining Berjalan", true);
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    renderMining();
  }, 1000);
}

async function refreshStatus() {
  if (loading) return;

  try {
    const data = await apiRequest("/api/me");

    player = getPlayer(data);
    mining = getMiningSession(data);

    updateProfile();
    updateBalance(data);
    renderMining();

    if (!tg?.initData) {
      showMessage(
        "Buka MinePoint melalui tombol aplikasi di Telegram untuk autentikasi.",
        "warning"
      );
    } else {
      clearMessage();
    }
  } catch (error) {
    if (elements.profileStatus) {
      elements.profileStatus.textContent = "Koneksi gagal";
    }

    showMessage(error.message, "error");
    renderMining();
  }
}

async function startMining() {
  if (loading) return;

  if (!tg?.initData) {
    showMessage(
      "Buka aplikasi melalui Telegram agar akun dapat diverifikasi.",
      "warning"
    );
    return;
  }

  loading = true;
  setButton("Memulai...", true);
  clearMessage();

  try {
    await apiRequest("/api/mine/start", {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage("Mining berhasil dimulai.", "success");
    await refreshStatus();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    loading = false;
    renderMining();
  }
}

async function claimReward() {
  if (loading) return;

  if (!tg?.initData) {
    showMessage(
      "Autentikasi Telegram diperlukan untuk klaim reward.",
      "warning"
    );
    return;
  }

  const endsAt = getEndsAt(mining);

  if (endsAt && Date.now() < endsAt) {
    showMessage("Mining belum selesai.", "warning");
    return;
  }

  loading = true;
  setButton("Mengklaim...", true);
  clearMessage();

  try {
    await apiRequest("/api/mine/claim", {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(
      `Reward ${MINING_REWARD_PTS} PTS berhasil diklaim.`,
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

function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const target = item.dataset.tab;

      navItems.forEach(nav => {
        nav.classList.toggle("active", nav === item);
      });

      pages.forEach(page => {
        page.classList.toggle("active", page.id === target);
      });
    });
  });
}

function setupMiningButton() {
  if (!elements.miningActionBtn) return;

  elements.miningActionBtn.addEventListener("click", () => {
    if (loading) return;

    const endsAt = getEndsAt(mining);

    if (mining && endsAt && Date.now() >= endsAt) {
      claimReward();
    } else if (!mining) {
      startMining();
    }
  });
}

async function init() {
  if (tg) {
    tg.ready();
    tg.expand();
  }

  setupNavigation();
  setupMiningButton();
  startTimer();

  await refreshStatus();

  if (refreshInterval) clearInterval(refreshInterval);

  refreshInterval = setInterval(() => {
    refreshStatus();
  }, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", init);
