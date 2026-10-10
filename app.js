const API_BASE_URL = "https://65947b5101e7e8.lhr.life";

const tg = window.Telegram?.WebApp;

const elements = {
  playerName: document.getElementById("playerName"),
  connectionStatus: document.getElementById("connectionStatus"),
  balance: document.getElementById("balance"),
  miningTimer: document.getElementById("miningTimer"),
  miningStatus: document.getElementById("miningStatus"),
  startBtn: document.getElementById("startBtn"),
  claimBtn: document.getElementById("claimBtn"),
  message: document.getElementById("message")
};

let currentMining = null;
let busy = false;
let lastMessage = "";

if (tg) {
  tg.ready();
  tg.expand();
}

function showMessage(text) {
  lastMessage = text;
  elements.message.textContent = text;
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
    throw new Error(
      "Buka MinePoint melalui tombol aplikasi di Telegram."
    );
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

function updateTimer() {
  if (!currentMining) {
    elements.miningTimer.textContent = "12:00:00";
    return;
  }

  const remaining = currentMining.endsAt - Date.now();

  if (remaining > 0) {
    elements.miningTimer.textContent = formatTime(remaining);
    elements.miningStatus.textContent = "Mining sedang berjalan...";
    elements.startBtn.disabled = true;
    elements.claimBtn.disabled = true;
  } else {
    elements.miningTimer.textContent = "00:00:00";
    elements.miningStatus.textContent =
      "Mining selesai! Reward siap diklaim.";
    elements.startBtn.disabled = true;
    elements.claimBtn.disabled = busy;
  }
}

function render(data) {
  const player = data.player;

  elements.playerName.textContent =
    player.username
      ? "@" + player.username
      : "Player#" + player.telegramId;

  elements.balance.textContent =
    Number(player.balancePts).toLocaleString("id-ID");

  elements.connectionStatus.textContent =
    "Telegram terverifikasi · tersambung";

  currentMining = data.mining;

  if (!currentMining) {
    elements.miningTimer.textContent = "12:00:00";
    elements.miningStatus.textContent = "Siap memulai sesi mining.";
    elements.startBtn.disabled = busy;
    elements.claimBtn.disabled = true;
  } else {
    updateTimer();
  }

  if (busy) {
    elements.startBtn.disabled = true;
    elements.claimBtn.disabled = true;
  }
}

async function refreshStatus() {
  if (!tg?.initData) {
    elements.playerName.textContent = "Belum terhubung";
    elements.connectionStatus.textContent =
      "Buka aplikasi melalui Telegram";
    elements.miningStatus.textContent =
      "Login Telegram diperlukan untuk bermain.";
    elements.startBtn.disabled = true;
    elements.claimBtn.disabled = true;
    showMessage(
      "Buka MinePoint melalui Telegram setelah URL HTTPS siap."
    );
    return;
  }

  try {
    const data = await apiRequest("/api/me");
    render(data);
    showMessage("");
  } catch (error) {
    elements.connectionStatus.textContent =
      "Autentikasi belum berhasil";
    showMessage(error.message);
  }
}

elements.startBtn.addEventListener("click", async () => {
  if (busy) return;

  busy = true;
  elements.startBtn.disabled = true;
  elements.claimBtn.disabled = true;
  showMessage("Memulai mining...");

  try {
    const data = await apiRequest("/api/mine/start", {
      method: "POST"
    });

    render(data);
    showMessage("Mining dimulai! 100 PTS setelah 12 jam.");
  } catch (error) {
    showMessage(error.message);
    await refreshStatus();
  } finally {
    busy = false;
    if (currentMining) {
      updateTimer();
    } else {
      elements.startBtn.disabled = false;
    }
  }
});

elements.claimBtn.addEventListener("click", async () => {
  if (busy) return;

  busy = true;
  elements.startBtn.disabled = true;
  elements.claimBtn.disabled = true;
  showMessage("Memproses klaim reward...");

  try {
    const data = await apiRequest("/api/mine/claim", {
      method: "POST"
    });

    render(data);
    showMessage(
      `Berhasil klaim ${data.claimedPts} PTS!`
    );
  } catch (error) {
    showMessage(error.message);
    await refreshStatus();
  } finally {
    busy = false;
    if (currentMining) {
      updateTimer();
    } else {
      elements.startBtn.disabled = false;
    }
  }
});

setInterval(() => {
  updateTimer();
}, 1000);

setInterval(() => {
  refreshStatus();
}, 15000);

refreshStatus();
