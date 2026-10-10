const API_BASE_URL = "https://3ba57908d20ded.lhr.life";
const MINING_DURATION_MS = 12 * 60 * 60 * 1000;

const tg = window.Telegram?.WebApp;

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

let currentMining = null;
let currentPlayer = null;
let busy = false;

if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#0B0618");
    tg.setBackgroundColor("#0B0618");
  } catch (_) {}
}

function showMessage(text) {
  elements.message.textContent = text || "";
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

async function apiRequest(url, options = {}) {
  const initData = tg?.initData || "";

  if (!initData) {
    throw new Error("Buka MinePoint melalui tombol aplikasi di Telegram.");
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      "X-Telegram-Init-Data": initData,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Permintaan gagal.");
  }

  return data;
}

function miningRemaining() {
  if (!currentMining) return 0;
  return Math.max(0, Number(currentMining.endsAt) - Date.now());
}

function updateTimer() {
  if (!currentMining) {
    elements.miningTimer.textContent = "12:00:00";
    elements.progressBar.style.width = "0%";
    elements.progressPercent.textContent = "0%";
    elements.miningStatus.textContent = "Siap memulai sesi mining";
    elements.actionBtn.textContent = busy ? "Memproses..." : "MULAI MINING";
    elements.actionBtn.classList.remove("claim");
    elements.actionBtn.disabled = busy;
    return;
  }

  const remaining = miningRemaining();

  if (remaining > 0) {
    const elapsed = MINING_DURATION_MS - remaining;
    const progress = Math.max(
      0,
      Math.min(100, (elapsed / MINING_DURATION_MS) * 100)
    );

    elements.miningTimer.textContent = formatTime(remaining);
    elements.progressBar.style.width = `${progress}%`;
    elements.progressPercent.textContent = `${Math.floor(progress)}%`;
    elements.miningStatus.textContent = "Mining sedang berjalan";
    elements.actionBtn.textContent = busy ? "Memproses..." : "MINING BERJALAN";
    elements.actionBtn.classList.remove("claim");
    elements.actionBtn.disabled = true;
  } else {
    elements.miningTimer.textContent = "00:00:00";
    elements.progressBar.style.width = "100%";
    elements.progressPercent.textContent = "100%";
    elements.miningStatus.textContent = "Sesi selesai · reward siap diklaim";
    elements.actionBtn.textContent = busy ? "Memproses..." : "KLAIM 100 PTS";
    elements.actionBtn.classList.add("claim");
    elements.actionBtn.disabled = busy;
  }
}

function render(data) {
  const player = data.player;
  currentPlayer = player;
  currentMining = data.mining;

  const username = player.username
    ? "@" + player.username
    : "Player#" + player.telegramId;

  const balance = Number(player.balancePts).toLocaleString("id-ID");

  elements.playerName.textContent = username;
  elements.connectionStatus.textContent = "Telegram terverifikasi";
  elements.profileId.textContent = player.telegramId ?? "—";
  elements.profileStatus.textContent = "Tersambung";
  elements.walletStatus.textContent = "PTS tersedia";
  elements.balance.textContent = balance;

  updateTimer();
}

async function refreshStatus() {
  if (!tg?.initData) {
    elements.playerName.textContent = "Belum terhubung";
    elements.connectionStatus.textContent = "Buka aplikasi melalui Telegram";
    elements.profileId.textContent = "—";
    elements.profileStatus.textContent = "Belum terhubung";
    elements.walletStatus.textContent = "Belum terhubung";
    elements.miningStatus.textContent = "Login Telegram diperlukan";
    elements.actionBtn.textContent = "BUKA MELALUI TELEGRAM";
    elements.actionBtn.disabled = true;
    showMessage("Buka MinePoint melalui tombol aplikasi di Telegram.");
    return;
  }

  try {
    const data = await apiRequest("/api/me");
    render(data);
    showMessage("");
  } catch (error) {
    elements.connectionStatus.textContent = "Autentikasi belum berhasil";
    elements.profileStatus.textContent = "Tidak terverifikasi";
    elements.walletStatus.textContent = "Tidak tersedia";
    showMessage(error.message);
  }
}

elements.actionBtn.addEventListener("click", async () => {
  if (busy) return;

  if (!tg?.initData) {
    showMessage("Buka MinePoint melalui Telegram.");
    return;
  }

  busy = true;
  updateTimer();

  try {
    if (!currentMining) {
      showMessage("Memulai mining...");
      const data = await apiRequest("/api/mine/start", {
        method: "POST"
      });
      render(data);
      showMessage("Mining dimulai. Reward 100 PTS tersedia setelah 12 jam.");
      return;
    }

    if (miningRemaining() > 0) return;

    showMessage("Memproses klaim reward...");
    const data = await apiRequest("/api/mine/claim", {
      method: "POST"
    });
    render(data);
    showMessage(`Berhasil klaim ${data.claimedPts} PTS!`);
  } catch (error) {
    showMessage(error.message);
    await refreshStatus();
  } finally {
    busy = false;
    updateTimer();
  }
});

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    const targetId = button.dataset.tab;

    document.querySelectorAll(".page").forEach(page => {
      page.classList.toggle("active", page.id === targetId);
    });

    document.querySelectorAll(".nav-item").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-current", active ? "page" : "false");
    });

    showMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

setInterval(updateTimer, 1000);
setInterval(refreshStatus, 15000);
refreshStatus();
