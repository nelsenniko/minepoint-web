"use strict";

// ========================================
// MINEPOINT V1 CONFIGURATION
// ========================================

const API_BASE_URL = "https://339c3e59fcc632.lhr.life";
const MINING_DURATION_MS = 12 * 60 * 60 * 1000;
const MINING_REWARD_PTS = 100;

const tg = window.Telegram?.WebApp;

// ========================================
// DOM ELEMENTS
// ========================================

const elements = {
  playerName: document.getElementById("profileName"),
  connectionStatus: document.getElementById("profileConnection"),
  profileId: document.getElementById("profileId"),
  profileStatus: document.getElementById("profileStatus"),

  balance: document.getElementById("walletBalance"),
  walletStatus: document.getElementById("walletStatus"),

  miningTimer: document.getElementById("miningTimer"),
  miningStatus: document.getElementById("miningStatus"),
  actionBtn: document.getElementById("miningActionBtn"),

  progressBar: document.getElementById("progressBar"),
  progressPercent: document.getElementById("progressPercent"),

  message: document.getElementById("message")
};

// ========================================
// APPLICATION STATE
// ========================================

let currentPlayer = null;
let currentMining = null;
let busy = false;
let refreshing = false;

// ========================================
// TELEGRAM MINI APP
// ========================================

if (tg) {
  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor("#0B0618");
    tg.setBackgroundColor("#0B0618");
  } catch (error) {
    console.warn("Telegram theme tidak tersedia:", error);
  }
}

// ========================================
// HELPERS
// ========================================

function showMessage(message = "") {
  if (elements.message) {
    elements.message.textContent = message;
  }
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

function formatPoints(points) {
  return Number(points || 0).toLocaleString("id-ID");
}

function getEndsAtTimestamp(mining) {
  if (!mining || mining.endsAt == null) {
    return 0;
  }

  // Mendukung timestamp milidetik atau tanggal ISO.
  if (typeof mining.endsAt === "number") {
    return mining.endsAt;
  }

  const value = Number(mining.endsAt);

  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  const parsed = Date.parse(mining.endsAt);

  return Number.isNaN(parsed) ? 0 : parsed;
}

function miningRemaining() {
  if (!currentMining) {
    return 0;
  }

  return Math.max(
    0,
    getEndsAtTimestamp(currentMining) - Date.now()
  );
}

// ========================================
// API REQUEST
// ========================================

async function apiRequest(url, options = {}) {
  const initData = tg?.initData || "";

  if (!initData) {
    throw new Error(
      "Buka MinePoint melalui tombol aplikasi di Telegram."
    );
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        "X-Telegram-Init-Data": initData,
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers
      }
    });
  } catch (error) {
    console.error("Koneksi backend gagal:", error);

    throw new Error(
      "Backend tidak dapat dijangkau. Periksa koneksi dan tunnel HTTPS."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        data.error ||
        "Autentikasi Telegram gagal. Buka ulang Mini App dari bot."
      );
    }

    if (response.status === 502 || response.status === 503) {
      throw new Error(
        "Tunnel backend sedang tidak tersedia. Periksa Termux."
      );
    }

    throw new Error(
      data.error || `Permintaan gagal (${response.status}).`
    );
  }

  return data;
}

// ========================================
// MINING TIMER AND BUTTON
// ========================================

function updateTimer() {
  if (
    !elements.miningTimer ||
    !elements.actionBtn ||
    !elements.miningStatus ||
    !elements.progressBar ||
    !elements.progressPercent
  ) {
    return;
  }

  // Belum ada sesi mining.
  if (!currentMining) {
    elements.miningTimer.textContent = "12:00:00";
    elements.progressBar.style.width = "0%";
    elements.progressPercent.textContent = "0%";

    elements.miningStatus.textContent =
      "Siap memulai sesi mining";

    elements.actionBtn.textContent = busy
      ? "MEMPROSES..."
      : "MULAI MINING";

    elements.actionBtn.classList.remove("claim");
    elements.actionBtn.disabled = busy;

    return;
  }

  const remaining = miningRemaining();

  // Mining masih berjalan.
  if (remaining > 0) {
    const elapsed = Math.max(
      0,
      MINING_DURATION_MS - remaining
    );

    const progress = Math.max(
      0,
      Math.min(
        100,
        (elapsed / MINING_DURATION_MS) * 100
      )
    );

    elements.miningTimer.textContent =
      formatTime(remaining);

    elements.progressBar.style.width =
      `${progress}%`;

    elements.progressPercent.textContent =
      `${Math.floor(progress)}%`;

    elements.miningStatus.textContent =
      "Mining sedang berjalan";

    elements.actionBtn.textContent = busy
      ? "MEMPROSES..."
      : "MINING BERJALAN";

    elements.actionBtn.classList.remove("claim");
    elements.actionBtn.disabled = true;

    return;
  }

  // Sesi selesai, reward siap diklaim.
  elements.miningTimer.textContent = "00:00:00";
  elements.progressBar.style.width = "100%";
  elements.progressPercent.textContent = "100%";

  elements.miningStatus.textContent =
    "Sesi selesai · reward siap diklaim";

  elements.actionBtn.textContent = busy
    ? "MEMPROSES..."
    : `KLAIM ${MINING_REWARD_PTS} PTS`;

  elements.actionBtn.classList.add("claim");
  elements.actionBtn.disabled = busy;
}

// ========================================
// RENDER PLAYER AND MINING
// ========================================

function render(data) {
  if (!data || !data.player) {
    throw new Error("Data pemain dari backend tidak valid.");
  }

  const player = data.player;

  currentPlayer = player;
  currentMining = data.mining || null;

  const username = player.username
    ? `@${player.username}`
    : `Player#${player.telegramId}`;

  const balance = formatPoints(player.balancePts);

  if (elements.playerName) {
    elements.playerName.textContent = username;
  }

  if (elements.connectionStatus) {
    elements.connectionStatus.textContent =
      "Telegram terverifikasi";
  }

  if (elements.profileId) {
    elements.profileId.textContent =
      player.telegramId ?? "—";
  }

  if (elements.profileStatus) {
    elements.profileStatus.textContent =
      "Tersambung";
  }

  if (elements.balance) {
    elements.balance.textContent = balance;
  }

  if (elements.walletStatus) {
    elements.walletStatus.textContent = "PTS tersedia";
  }

  updateTimer();
}

// ========================================
// LOAD PLAYER STATUS
// ========================================

async function refreshStatus() {
  if (refreshing) {
    return;
  }

  if (!tg?.initData) {
    if (elements.playerName) {
      elements.playerName.textContent = "Belum terhubung";
    }

    if (elements.connectionStatus) {
      elements.connectionStatus.textContent =
        "Buka aplikasi melalui Telegram";
    }

    if (elements.profileId) {
      elements.profileId.textContent = "—";
    }

    if (elements.profileStatus) {
      elements.profileStatus.textContent =
        "Belum terhubung";
    }

    if (elements.balance) {
      elements.balance.textContent = "0";
    }

    if (elements.walletStatus) {
      elements.walletStatus.textContent =
        "Belum terhubung";
    }

    if (elements.miningStatus) {
      elements.miningStatus.textContent =
        "Login Telegram diperlukan";
    }

    if (elements.actionBtn) {
      elements.actionBtn.textContent =
        "BUKA MELALUI TELEGRAM";

      elements.actionBtn.disabled = true;
    }

    showMessage(
      "Buka MinePoint melalui tombol aplikasi di Telegram."
    );

    return;
  }

  refreshing = true;

  try {
    const data = await apiRequest("/api/me");

    render(data);
    showMessage("");

  } catch (error) {
    console.error("Gagal memuat status:", error);

    if (elements.connectionStatus) {
      elements.connectionStatus.textContent =
        "Koneksi atau autentikasi gagal";
    }

    if (elements.profileStatus) {
      elements.profileStatus.textContent =
        "Belum terverifikasi";
    }

    if (elements.walletStatus) {
      elements.walletStatus.textContent =
        "Tidak tersedia";
    }

    showMessage(error.message);

  } finally {
    refreshing = false;
  }
}

// ========================================
// START MINING OR CLAIM REWARD
// ========================================

if (elements.actionBtn) {
  elements.actionBtn.addEventListener(
    "click",
    async () => {
      if (busy) {
        return;
      }

      if (!tg?.initData) {
        showMessage(
          "Buka MinePoint melalui Telegram."
        );
        return;
      }

      // Sesi masih berjalan, tidak boleh memulai sesi baru.
      if (currentMining && miningRemaining() > 0) {
        return;
      }

      busy = true;
      updateTimer();

      try {
        // START MINING
        if (!currentMining) {
          showMessage("Memulai sesi mining...");

          const data = await apiRequest(
            "/api/mine/start",
            { method: "POST" }
          );

          render(data);

          showMessage(
            "Mining dimulai! Reward 100 PTS setelah 12 jam."
          );

          return;
        }

        // CLAIM REWARD
        showMessage("Memproses klaim reward...");

        const data = await apiRequest(
          "/api/mine/claim",
          { method: "POST" }
        );

        render(data);

        showMessage(
          `Berhasil klaim ${formatPoints(data.claimedPts)} PTS!`
        );

      } catch (error) {
        console.error("Aksi mining gagal:", error);

        showMessage(error.message);

        // Muat ulang status dari server.
        await refreshStatus();

      } finally {
        busy = false;
        updateTimer();
      }
    }
  );
}

// ========================================
// BOTTOM NAVIGATION
// ========================================

const navButtons = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");

navButtons.forEach(button => {
  button.addEventListener("click", () => {
    const targetId = button.dataset.tab;

    pages.forEach(page => {
      page.classList.toggle(
        "active",
        page.id === targetId
      );
    });

    navButtons.forEach(item => {
      const active = item === button;

      item.classList.toggle("active", active);

      item.setAttribute(
        "aria-current",
        active ? "page" : "false"
      );
    });

    showMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
});

// ========================================
// AUTOMATIC REFRESH
// ========================================

// Timer diperbarui setiap detik.
setInterval(updateTimer, 1000);

// Status akun disegarkan setiap 15 detik.
setInterval(() => {
  refreshStatus();
}, 15000);

// ========================================
// INITIALIZE
// ========================================

refreshStatus();
