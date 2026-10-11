"use strict";

const tg = window.Telegram?.WebApp;
const DURATION = 12 * 60 * 60 * 1000;
const REWARD = 100;

const $ = (id) => document.getElementById(id);

if (tg) {
  tg.ready();
  tg.expand();
}

const telegramUser = tg?.initDataUnsafe?.user;
const userKey = telegramUser?.id
  ? `minepoint_${telegramUser.id}`
  : "minepoint_guest";

function loadData() {
  try {
    const saved = localStorage.getItem(userKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.balance === "number" &&
        (parsed.startTime === null ||
          typeof parsed.startTime === "number") &&
        typeof parsed.claimed === "boolean"
      ) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("Data lokal tidak dapat dibaca.", error);
  }

  return { balance: 0, startTime: null, claimed: false };
}

let data = loadData();

function saveData() {
  try {
    localStorage.setItem(userKey, JSON.stringify(data));
  } catch (error) {
    console.error("Data lokal tidak dapat disimpan.", error);
    alert("Penyimpanan browser gagal. Periksa ruang penyimpanan.");
  }
}

function renderPlayer() {
  if (telegramUser) {
    const name = telegramUser.username
      ? `@${telegramUser.username}`
      : [telegramUser.first_name, telegramUser.last_name]
          .filter(Boolean)
          .join(" ");

    $("username").textContent = name || "Pemain Telegram";
    $("authStatus").textContent = "Telegram terdeteksi · mode lokal";
  } else {
    $("username").textContent = "Pemain";
    $("authStatus").textContent =
      "Buka aplikasi melalui Telegram untuk melihat profil";
  }
}

function render() {
  $("balance").textContent = data.balance.toLocaleString("id-ID");

  if (data.startTime === null) {
    $("timer").textContent = "12:00:00";
    $("miningStatus").textContent = "Belum mulai mining";
    $("progress").style.width = "0%";
    $("mineButton").disabled = false;
    $("mineButton").textContent = "Mulai Mining";
    $("claimButton").disabled = true;
    return;
  }

  const elapsed = Math.max(0, Date.now() - data.startTime);
  const remaining = Math.max(0, DURATION - elapsed);
  const completed = remaining === 0;
  const progress = Math.min(100, (elapsed / DURATION) * 100);

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  $("timer").textContent = [hours, minutes, seconds]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

  $("progress").style.width = `${progress}%`;

  if (data.claimed) {
    $("miningStatus").textContent =
      "Sesi selesai. Mulai sesi mining berikutnya.";
    $("mineButton").disabled = false;
    $("mineButton").textContent = "Mulai Mining";
    $("claimButton").disabled = true;
  } else if (completed) {
    $("miningStatus").textContent =
      "Mining selesai! Reward siap diklaim.";
    $("mineButton").disabled = true;
    $("mineButton").textContent = "Mining Selesai";
    $("claimButton").disabled = false;
  } else {
    $("miningStatus").textContent = "Mining sedang berjalan...";
    $("mineButton").disabled = true;
    $("mineButton").textContent = "Mining Berjalan";
    $("claimButton").disabled = true;
  }
}

$("mineButton").addEventListener("click", () => {
  if (data.startTime !== null && !data.claimed) return;

  data.startTime = Date.now();
  data.claimed = false;
  saveData();
  render();
});

$("claimButton").addEventListener("click", () => {
  if (data.startTime === null || data.claimed) return;
  if (Date.now() - data.startTime < DURATION) return;

  data.balance += REWARD;
  data.claimed = true;
  saveData();
  render();

  if (tg) {
    tg.showAlert("Berhasil! Kamu mendapatkan 100 PTS.");
  } else {
    alert("Berhasil! Kamu mendapatkan 100 PTS.");
  }
});

renderPlayer();
render();
setInterval(render, 1000);
