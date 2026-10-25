/**
 * MOCHI S3 WEB FLASHER
 * Dasai Mochi Robot (ESP32-S3) — online firmware programmer
 * Built on the Web Serial API + esptool-js
 */

import { ESPLoader, Transport } from "./lib/esptool-bundle.js";

/* ==================================================================
 *  1. FIRMWARE MANIFEST
 * ================================================================== */
const FIRMWARE_MANIFEST = [
  {
    id: "mochi_xiao_64",
    name: "Mochi S3 · XIAO ESP32-S3 · SSD1306 128×64",
    chip: "ESP32-S3",
    desc:
      "Board XIAO ESP32-S3 (Seeed) · màn hình SSD1306 <b>128×64</b> · I2C chân <code>SDA=8 / SCL=9</code> · cảm ứng chân 1 · Flash 8MB.",
    infoFile: "info/mochi-s3.txt",
    files: [
      { name: "mochi-xiao-64.bootloader.bin", path: "firmware/mochi-xiao-64.bootloader.bin", offset: 0x0000, desc: "Bootloader" },
      { name: "mochi-xiao-64.partitions.bin", path: "firmware/mochi-xiao-64.partitions.bin", offset: 0x8000, desc: "Partitions" },
      { name: "mochi-xiao-64.bin", path: "firmware/mochi-xiao-64.bin", offset: 0x10000, desc: "Main Code" }
    ]
  }
];

/* ==================================================================
 *  2. STATE
 * ================================================================== */
let port = null;
let esploader = null;
let transport = null;
let isConnected = false;
let currentRawReadmeText = "";
let currentActiveTab = "presetTab";
let detectedChip = "";

/* ==================================================================
 *  3. DOM
 * ================================================================== */
const $ = (id) => document.getElementById(id);
const baudRateSelect = $("baudRateSelect");
const eraseFlashCheckbox = $("eraseFlashCheckbox");
const btnConnect = $("btnConnect");
const btnDisconnect = $("btnDisconnect");
const btnFlash = $("btnFlash");
const btnResetBoard = $("btnResetBoard");
const btnClearConsole = $("btnClearConsole");
const serialStatusIndicator = $("serialStatusIndicator");
const statusLabel = $("statusLabel");
const chipDetectedBadge = $("chipDetectedBadge");
const deviceDetails = $("deviceDetails");
const valChipName = $("valChipName");
const valChipMac = $("valChipMac");
const valChipFeatures = $("valChipFeatures");
const valChipCrystal = $("valChipCrystal");
const serialConsole = $("serialConsole");
const unsupportedWarning = $("unsupportedWarning");
const chipWarn = $("chipWarn");

const versionSelect = $("versionSelect");
const presetDesc = $("presetDesc");
const presetBootOffset = $("presetBootOffset");
const presetBootFile = $("presetBootFile");
const presetPartOffset = $("presetPartOffset");
const presetPartFile = $("presetPartFile");
const presetAppOffset = $("presetAppOffset");
const presetAppFile = $("presetAppFile");

const flashProgressContainer = $("flashProgressContainer");
const flashProgressBar = $("flashProgressBar");
const flashProgressText = $("flashProgressText");
const flashProgressPercent = $("flashProgressPercent");
const flashSuccess = $("flashSuccess");

const currentInfoFilePath = $("currentInfoFilePath");
const readmeContent = $("readmeContent");
const btnCopyReadme = $("btnCopyReadme");
const btnDownloadTxt = $("btnDownloadTxt");

const customBootOffset = $("customBootOffset");
const fileCustomBoot = $("fileCustomBoot");
const customPartOffset = $("customPartOffset");
const fileCustomPart = $("fileCustomPart");
const customAppOffset = $("customAppOffset");
const fileCustomApp = $("fileCustomApp");

const exprGrid = $("exprGrid");
const previewExprName = $("previewExprName");
const previewFps = $("previewFps");
const downloadList = $("downloadList");

/* ==================================================================
 *  4. TERMINAL
 * ================================================================== */
const espTerminal = {
  clean() { serialConsole.innerHTML = ""; },
  writeLine(text) { appendLog(text, "info-text"); },
  write(text) { appendLog(text, "info-text", false); }
};

function appendLog(message, className = "info-text", newline = true) {
  if (!message) return;
  const line = document.createElement("div");
  line.className = `term-line ${className}`;
  line.textContent = message;
  serialConsole.appendChild(line);
  serialConsole.scrollTop = serialConsole.scrollHeight;
}

/* ==================================================================
 *  5. MARKDOWN (mini renderer, GitHub-ish)
 * ================================================================== */
function renderMarkdown(md) {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
  html = html.replace(/^&gt; (.*$)/gim, "<blockquote>$1</blockquote>");
  html = html.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");
  html = html.replace(/^---$/gim, "<hr>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/((?:\|.*?\|\r?\n)+)/g, (match) => {
    const rows = match.trim().split("\n");
    let out = "<table>";
    let isHeader = true;
    for (const row of rows) {
      if (/^\|[\s:|-]+\|$/.test(row.trim())) continue;
      const cells = row.split("|").slice(1, -1);
      if (!cells.length) continue;
      out += "<tr>";
      cells.forEach((c) => {
        const tag = isHeader ? "th" : "td";
        out += `<${tag}>${c.trim()}</${tag}>`;
      });
      out += "</tr>";
      isHeader = false;
    }
    return out + "</table>";
  });

  html = html.replace(/^\s*[-\*]\s+(.*$)/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gims, (m) => `<ul>${m}</ul>`);
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, "<li>$1</li>");

  const blocks = html.split(/\n\s*\n/);
  html = blocks
    .map((b) => {
      b = b.trim();
      if (!b) return "";
      if (/^<(h\d|table|pre|ul|ol|hr|blockquote)/.test(b)) return b;
      return `<p>${b.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

async function loadVersionInfo(infoPath) {
  currentInfoFilePath.textContent = infoPath;
  btnDownloadTxt.href = infoPath;
  readmeContent.innerHTML = `<div class="loading-spinner">Đang tải file thông tin từ <code>${infoPath}</code>…</div>`;
  try {
    const res = await fetch(infoPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    currentRawReadmeText = text;
    readmeContent.innerHTML = renderMarkdown(text);
  } catch (err) {
    readmeContent.innerHTML = `<div class="term-line error-text">Không thể đọc file: ${err.message}</div>`;
  }
}

/* ==================================================================
 *  6. VERSION SELECTOR
 * ================================================================== */
function initVersionSelector() {
  versionSelect.innerHTML = "";
  FIRMWARE_MANIFEST.forEach((fw) => {
    const opt = document.createElement("option");
    opt.value = fw.id;
    opt.textContent = fw.name;
    versionSelect.appendChild(opt);
  });
  versionSelect.addEventListener("change", () => {
    const selected = FIRMWARE_MANIFEST.find((f) => f.id === versionSelect.value);
    if (selected) {
      updatePresetDisplay(selected);
      loadVersionInfo(selected.infoFile);
    }
  });
  if (FIRMWARE_MANIFEST.length) {
    updatePresetDisplay(FIRMWARE_MANIFEST[0]);
    loadVersionInfo(FIRMWARE_MANIFEST[0].infoFile);
  }
}

function updatePresetDisplay(fw) {
  const boot = fw.files.find((f) => f.desc === "Bootloader") || fw.files[0];
  const part = fw.files.find((f) => f.desc === "Partitions") || fw.files[1];
  const app = fw.files.find((f) => f.desc === "Main Code") || fw.files[2];

  presetBootOffset.textContent = "0x" + boot.offset.toString(16).toUpperCase();
  presetBootFile.textContent = boot.name;
  presetPartOffset.textContent = "0x" + part.offset.toString(16).toUpperCase();
  presetPartFile.textContent = part.name;
  presetAppOffset.textContent = "0x" + app.offset.toString(16).toUpperCase();
  presetAppFile.textContent = app.name;

  presetDesc.innerHTML = fw.desc;
}

/* ==================================================================
 *  7. TABS + BUTTONS
 * ================================================================== */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    currentActiveTab = btn.getAttribute("data-tab");
    document.getElementById(currentActiveTab).classList.add("active");
    $("modeBadge").textContent = currentActiveTab === "presetTab" ? "Preset Cloud" : "Custom Files";
  });
});

btnCopyReadme.addEventListener("click", async () => {
  if (!currentRawReadmeText) return;
  try {
    await navigator.clipboard.writeText(currentRawReadmeText);
    const old = btnCopyReadme.textContent;
    btnCopyReadme.textContent = "✓ Đã sao chép";
    setTimeout(() => (btnCopyReadme.textContent = old), 2000);
  } catch (e) {
    alert("Không thể sao chép: " + e.message);
  }
});

btnClearConsole.addEventListener("click", () => {
  serialConsole.innerHTML = "";
});

/* ==================================================================
 *  8. WEB SERIAL
 * ================================================================== */
if (!("serial" in navigator)) {
  unsupportedWarning.classList.remove("hidden");
  btnConnect.disabled = true;
  appendLog(
    "⚠️ Trình duyệt của bạn không hỗ trợ Web Serial API. Vui lòng mở trang này bằng Google Chrome, Microsoft Edge hoặc Opera.",
    "error-text"
  );
}

btnConnect.addEventListener("click", async () => {
  try {
    appendLog("⏳ Đang yêu cầu cấp quyền cổng Serial (Web Serial API)…");
    port = await navigator.serial.requestPort();

    transport = new Transport(port);
    const baudRate = parseInt(baudRateSelect.value, 10) || 115200;

    appendLog(`🔌 Đang kết nối thiết bị (ROM baudrate 115200, tốc độ nạp ${baudRate})…`);

    esploader = new ESPLoader({
      transport,
      baudrate: baudRate,
      terminal: espTerminal,
      romBaudrate: 115200
    });

    const chip = await esploader.main();
    detectedChip = chip;
    isConnected = true;

    serialStatusIndicator.classList.add("connected");
    statusLabel.textContent = `Đã kết nối (${chip})`;
    chipDetectedBadge.textContent = chip;
    chipDetectedBadge.classList.add("active");
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    btnResetBoard.disabled = false;

    valChipName.textContent = chip;
    try {
      valChipMac.textContent = await esploader.chip.readMac(esploader);
    } catch {
      valChipMac.textContent = "N/A";
    }
    try {
      const features = await esploader.chip.getChipFeatures(esploader);
      valChipFeatures.textContent = Array.isArray(features) ? features.join(", ") : String(features);
    } catch {
      valChipFeatures.textContent = "Standard";
    }
    try {
      const xtal = await esploader.chip.getCrystalFreq(esploader);
      valChipCrystal.textContent = xtal ? `${xtal} MHz` : "40 MHz";
    } catch {
      valChipCrystal.textContent = "40 MHz";
    }

    deviceDetails.classList.remove("hidden");
    appendLog(`🎉 Kết nối thành công! Dòng chip: ${chip}`, "success-text");

    if (!/S3/i.test(chip)) {
      chipWarn.classList.remove("hidden");
      chipWarn.innerHTML =
        `⚠️ Chip của bạn là <b>${chip}</b>, không phải ESP32-S3. Các bản firmware Mochi S3 trong danh sách được build cho <b>ESP32-S3</b> — nạp có thể không hoạt động.`;
      appendLog(`⚠️ Cảnh báo: chip ${chip} không phải ESP32-S3.`, "warn-text");
    } else {
      chipWarn.classList.add("hidden");
      appendLog("💡 Chip ESP32-S3 hợp lệ — chọn đúng phiên bản firmware theo board của bạn rồi bấm FLASH.", "success-text");
    }
  } catch (err) {
    console.error(err);
    appendLog(`❌ Lỗi kết nối: ${err.message}`, "error-text");
    disconnectDevice();
  }
});

async function disconnectDevice() {
  if (transport) { try { await transport.disconnect(); } catch (e) { console.warn(e); } }
  if (port) { try { await port.close(); } catch (e) { console.warn(e); } }
  port = null;
  transport = null;
  esploader = null;
  isConnected = false;

  serialStatusIndicator.classList.remove("connected");
  statusLabel.textContent = "Chưa kết nối cổng COM";
  chipDetectedBadge.textContent = "Chưa nhận diện";
  chipDetectedBadge.classList.remove("active");
  deviceDetails.classList.add("hidden");
  chipWarn.classList.add("hidden");

  btnConnect.disabled = false;
  btnDisconnect.disabled = true;
  btnResetBoard.disabled = true;

  appendLog("🔌 Đã ngắt kết nối cổng COM.", "muted-text");
}
btnDisconnect.addEventListener("click", disconnectDevice);

/* ==================================================================
 *  9. FLASH
 * ================================================================== */
function readFileAsBinary(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(file);
  });
}

async function fetchBinaryFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ${url} (HTTP ${res.status})`);
  const blob = await res.blob();
  return readFileAsBinary(blob);
}

btnFlash.addEventListener("click", async () => {
  if (!isConnected || !esploader) {
    alert("Hãy kết nối với ESP32-S3 bằng nút “Kết nối cổng COM” trước khi nạp!");
    return;
  }

  const fileArray = [];
  flashSuccess.classList.add("hidden");

  try {
    btnFlash.disabled = true;
    flashProgressContainer.classList.remove("hidden");
    flashProgressBar.style.width = "0%";
    flashProgressPercent.textContent = "0%";
    flashProgressText.textContent = "Đang chuẩn bị file firmware…";

    if (currentActiveTab === "presetTab") {
      const selected = FIRMWARE_MANIFEST.find((f) => f.id === versionSelect.value);
      if (!selected) throw new Error("Chưa chọn phiên bản firmware hợp lệ!");

      appendLog(`📦 Chuẩn bị 3 file nhị phân: ${selected.name}`, "pink-text");
      for (const item of selected.files) {
        flashProgressText.textContent = `Đang tải ${item.name}…`;
        appendLog(`⬇️  Tải ${item.name} (${item.desc}) @ 0x${item.offset.toString(16).toUpperCase()}…`);
        const data = await fetchBinaryFromUrl(item.path);
        fileArray.push({ data, address: item.offset });
      }
    } else {
      const bootFile = fileCustomBoot.files[0];
      const partFile = fileCustomPart.files[0];
      const appFile = fileCustomApp.files[0];
      if (!bootFile && !partFile && !appFile) {
        throw new Error("Hãy chọn ít nhất 1 file .bin để nạp!");
      }
      if (bootFile) {
        const offset = parseInt(customBootOffset.value, 16);
        fileArray.push({ data: await readFileAsBinary(bootFile), address: offset });
        appendLog(`📁 Bootloader: ${bootFile.name} @ 0x${offset.toString(16)}`);
      }
      if (partFile) {
        const offset = parseInt(customPartOffset.value, 16);
        fileArray.push({ data: await readFileAsBinary(partFile), address: offset });
        appendLog(`📁 Partitions: ${partFile.name} @ 0x${offset.toString(16)}`);
      }
      if (appFile) {
        const offset = parseInt(customAppOffset.value, 16);
        fileArray.push({ data: await readFileAsBinary(appFile), address: offset });
        appendLog(`📁 Main App: ${appFile.name} @ 0x${offset.toString(16)}`);
      }
    }

    const eraseAll = eraseFlashCheckbox.checked;
    appendLog(
      `⚡ Bắt đầu nạp (${fileArray.length} phân vùng · Full Erase = ${eraseAll ? "CÓ" : "KHÔNG"})…`,
      "warn-text"
    );

    const flashOptions = {
      fileArray,
      flashSize: "keep",
      eraseAll,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const percent = Math.floor((written / total) * 100);
        flashProgressBar.style.width = `${percent}%`;
        flashProgressPercent.textContent = `${percent}%`;
        flashProgressText.textContent = `Đang ghi phân vùng ${fileIndex + 1}/${fileArray.length}: ${percent}% (${written}/${total} bytes)`;
      },
      calculateMD5Hash: (image) =>
        CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)).toString()
    };

    await esploader.writeFlash(flashOptions);

    flashProgressBar.style.width = "100%";
    flashProgressPercent.textContent = "100%";
    flashProgressText.textContent = "✅ Nạp firmware Mochi S3 hoàn tất!";
    appendLog("🎉🎉🎉 NẠP FIRMWARE MOCHI S3 THÀNH CÔNG 100%!", "success-text");
    appendLog("💡 Nhấn “Reset Chip” hoặc rút/cắm lại cáp USB để Mochi chạy firmware mới.", "success-text");
    flashSuccess.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    appendLog(`❌ Lỗi khi nạp firmware: ${err.message}`, "error-text");
    flashProgressText.textContent = `Lỗi: ${err.message}`;
  } finally {
    btnFlash.disabled = false;
  }
});

btnResetBoard.addEventListener("click", async () => {
  if (!esploader) return;
  try {
    appendLog("🔄 Đang gửi tín hiệu Reset chip ESP32-S3…");
    await esploader.hardReset();
    appendLog("✅ Đã reset chip thành công!", "success-text");
  } catch (err) {
    appendLog(`❌ Lỗi reset: ${err.message}`, "error-text");
  }
});

/* ==================================================================
 * 10. MOCHI LIVE PREVIEW (canvas)
 * ================================================================== */
const EXPRESSIONS = [
  { id: "idle", label: "Idle", eye: "round", mouth: null },
  { id: "happy", label: "Happy", eye: "arcUp", mouth: "smile" },
  { id: "love", label: "Love", eye: "heart", mouth: "smile" },
  { id: "angry", label: "Angry", eye: "round", mouth: "frown", brow: "angry" },
  { id: "sad", label: "Sad", eye: "arcDown", mouth: "frown", brow: "sad" },
  { id: "sleepy", label: "Sleepy", eye: "half", mouth: "o" },
  { id: "surprise", label: "Surprise", eye: "wide", mouth: "o" },
  { id: "thinking", label: "Thinking", eye: "round", mouth: "line", look: [-4, -4] },
  { id: "dizzy", label: "Dizzy", eye: "spiral", mouth: "wave" },
  { id: "wink", label: "Wink", eye: "arcUp", eyeR: "closed", mouth: "smile" },
  { id: "laugh", label: "Laugh", eye: "arcUp", mouth: "grin" },
  { id: "talk", label: "Talking", eye: "round", mouth: "open" },
  { id: "cool", label: "Cool", eye: "narrow", mouth: "smile" },
  { id: "cry", label: "Cry", eye: "arcDown", mouth: "open", tear: true },
  { id: "curious", label: "Curious", eye: "round", mouth: "line" },
  { id: "excited", label: "Excited", eye: "wide", mouth: "grin" },
  { id: "loading", label: "Loading", eye: "round", mouth: "line" }
];

const EYE_CY = 26, EYE_RX = 12, EYE_RY = 14, EYE_LX = 40, EYE_RP = 88, MOUTH_CY = 52;

let previewIndex = 0;
let previewManualUntil = 0;
let previewStart = performance.now();

function ellipseFill(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPupil(ctx, cx, cy, rx, ry, ox, oy) {
  const pr = Math.max(1, rx * 0.38);
  ctx.fillStyle = "#000";
  ellipseFill(ctx, cx + ox, cy + oy, pr, pr);
  ctx.fillStyle = "#fff";
  ellipseFill(ctx, cx + ox - pr / 2, cy + oy - pr / 2, Math.max(0.6, pr * 0.38), Math.max(0.6, pr * 0.38));
}

function drawEye(ctx, cx, cy, rx, ry, style, ox, oy) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  switch (style) {
    case "arcUp":
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.35, rx * 0.95, ry * 0.85, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      break;
    case "arcDown":
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy - ry * 0.35, rx * 0.95, ry * 0.85, 0, 0, Math.PI);
      ctx.stroke();
      break;
    case "closed":
      ctx.fillRect(cx - rx, cy - 1.5, rx * 2, 3);
      break;
    case "half":
      ellipseFill(ctx, cx, cy, rx, ry);
      ctx.fillStyle = "#000";
      ctx.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry);
      ctx.fillStyle = "#fff";
      drawPupil(ctx, cx, cy, rx, ry, ox, oy);
      break;
    case "wide":
      ellipseFill(ctx, cx, cy, rx * 1.12, ry * 1.12);
      drawPupil(ctx, cx, cy, rx * 0.85, ry * 0.85, ox, oy);
      break;
    case "narrow":
      ellipseFill(ctx, cx, cy, rx, ry * 0.42);
      drawPupil(ctx, cx, cy, rx, ry * 0.42, ox, oy);
      break;
    case "x":
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy - ry / 2); ctx.lineTo(cx + rx, cy + ry / 2);
      ctx.moveTo(cx + rx, cy - ry / 2); ctx.lineTo(cx - rx, cy + ry / 2);
      ctx.stroke();
      break;
    case "heart": {
      ctx.beginPath();
      const s = rx / 7.5;
      for (let i = 0; i <= 60; i++) {
        const t = (i * Math.PI * 2) / 60;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const px = cx + hx * s, py = cy - hy * s;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#000";
      ellipseFill(ctx, cx - rx * 0.28, cy - ry * 0.2, 2, 2);
      break;
    }
    case "spiral": {
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 90; i++) {
        const a = i * 0.32, r = i * 0.13;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.85;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      break;
    }
    case "dot":
      ellipseFill(ctx, cx + ox, cy + oy, 2.4, 2.4);
      break;
    case "round":
    default:
      ellipseFill(ctx, cx, cy, rx, ry);
      drawPupil(ctx, cx, cy, rx, ry, ox, oy);
      break;
  }
}

function drawMouth(ctx, cx, cy, style, t) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  switch (style) {
    case "smile":
      ctx.beginPath();
      ctx.ellipse(cx, cy - 9, 14, 9, 0, 0, Math.PI);
      ctx.stroke();
      break;
    case "frown":
      ctx.beginPath();
      ctx.ellipse(cx, cy + 9, 14, 9, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      break;
    case "open": {
      const h = 4 + Math.abs(Math.sin(t * 9)) * 8;
      ellipseFill(ctx, cx, cy, 9, h);
      break;
    }
    case "o":
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 6 + Math.abs(Math.sin(t * 3)) * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "grin":
      ctx.beginPath();
      ctx.ellipse(cx, cy - 10, 17, 10, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(cx - 12, cy - 8, 25, 2);
      break;
    case "wave":
      ctx.beginPath();
      for (let i = 0; i <= 26; i++) {
        const px = cx - 13 + i, py = cy + Math.sin(i * 0.55) * 3;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      break;
    case "line":
    default:
      ctx.fillRect(cx - 7, cy - 1, 15, 2.4);
      break;
  }
}

function drawBrow(ctx, cx, cy, rx, ry, kind) {
  const y = cy - ry - 5;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  if (kind === "angry") {
    ctx.moveTo(cx - rx, y + 3); ctx.lineTo(cx + rx, y - 2);
  } else {
    ctx.moveTo(cx - rx, y - 2); ctx.lineTo(cx + rx, y + 3);
  }
  ctx.stroke();
}

function renderPreview(now) {
  const canvas = $("mochiCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const expr = EXPRESSIONS[previewIndex % EXPRESSIONS.length];
  const t = (now - previewStart) / 1000;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(2, 2);  // 128×64 logical space

  // idle look-around
  let ox = 0, oy = 0;
  if (expr.id === "idle" || expr.id === "curious") {
    ox = Math.round(Math.sin(t * 0.7) * 3);
    oy = Math.round(Math.cos(t * 0.5) * 2);
  }
  if (expr.look) { ox = expr.look[0]; oy = expr.look[1]; }

  // blink every ~4s
  const blinkPhase = (now % 4200) / 4200;
  const blinking = blinkPhase > 0.965;

  let eyeL = expr.eye;
  let eyeR = expr.eyeR || expr.eye;
  if (blinking && ["round", "wide", "half"].includes(eyeL)) eyeL = "closed";
  if (blinking && ["round", "wide", "half"].includes(eyeR)) eyeR = "closed";

  const shake = expr.id === "angry" ? Math.round(Math.sin(t * 20) * 1.2) : 0;

  drawEye(ctx, EYE_LX + shake, EYE_CY, EYE_RX, EYE_RY, eyeL, ox, oy);
  drawEye(ctx, EYE_RP + shake, EYE_CY, EYE_RX, EYE_RY, eyeR, ox, oy);

  if (expr.brow) {
    drawBrow(ctx, EYE_LX + shake, EYE_CY, EYE_RX, EYE_RY, expr.brow);
    drawBrow(ctx, EYE_RP + shake, EYE_CY, EYE_RX, EYE_RY, expr.brow);
  }

  if (expr.mouth) drawMouth(ctx, 64 + shake, MOUTH_CY, expr.mouth, t);

  // extras
  if (expr.tear) {
    ctx.fillStyle = "#fff";
    const ty = EYE_CY + 10 + ((t * 14) % 14);
    ellipseFill(ctx, EYE_LX + EYE_RX + 3, ty, 1.6, 1.6);
    ellipseFill(ctx, EYE_RP - EYE_RX - 3, ty, 1.6, 1.6);
  }
  if (expr.id === "love") {
    ctx.fillStyle = "#fff";
    const hy = EYE_CY - 14 + Math.sin(t * 3) * 3;
    ctx.beginPath();
    const s = 5.5;
    for (let i = 0; i <= 40; i++) {
      const th = (i * Math.PI * 2) / 40;
      const hx = 16 * Math.pow(Math.sin(th), 3);
      const hyy = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th);
      const px = EYE_LX - EYE_RX - 8 + hx * s, py = hy - hyy * s;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (expr.id === "sleepy") {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.6;
    const zy = EYE_CY - 12 - ((t * 9) % 12);
    ctx.beginPath();
    ctx.moveTo(EYE_RP + 8, zy); ctx.lineTo(EYE_RP + 12, zy - 4);
    ctx.lineTo(EYE_RP + 12, zy - 8); ctx.lineTo(EYE_RP + 8, zy - 4);
    ctx.stroke();
  }
  if (expr.id === "thinking") {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(100, 12, 4, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(100, 17, 2, 4);
    ctx.fillRect(100, 24, 2, 2);
  }
  if (expr.id === "excited") {
    ctx.fillStyle = "#fff";
    star(ctx, EYE_LX - EYE_RX - 7, EYE_CY - 12, 4);
    star(ctx, EYE_RP + EYE_RX + 8, EYE_CY - 14, 3);
  }

  // auto-advance
  if (now > previewManualUntil) {
    if (now - previewStart > 3600) {
      previewStart = now;
      previewIndex = (previewIndex + 1) % EXPRESSIONS.length;
      previewExprName.textContent = EXPRESSIONS[previewIndex].label;
      syncExprButtons();
    }
  }
}

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function syncExprButtons() {
  document.querySelectorAll(".expr-btn").forEach((b, i) => {
    b.classList.toggle("active", i === previewIndex % EXPRESSIONS.length);
  });
}

function initExprGrid() {
  EXPRESSIONS.forEach((e, i) => {
    const btn = document.createElement("button");
    btn.className = "expr-btn";
    btn.textContent = e.label;
    btn.addEventListener("click", () => {
      previewIndex = i;
      previewStart = performance.now();
      previewManualUntil = performance.now() + 6000;
      previewExprName.textContent = e.label;
      syncExprButtons();
    });
    exprGrid.appendChild(btn);
  });
  syncExprButtons();
}

let fpsCounter = 0, fpsLast = performance.now();
function previewLoop(now) {
  renderPreview(now);
  fpsCounter++;
  if (now - fpsLast >= 1000) {
    previewFps.textContent = `${fpsCounter} fps`;
    fpsCounter = 0;
    fpsLast = now;
  }
  requestAnimationFrame(previewLoop);
}

/* ==================================================================
 * 11. DOWNLOAD LIST
 * ================================================================== */
function initDownloadList() {
  downloadList.innerHTML = "";
  FIRMWARE_MANIFEST.forEach((fw) => {
    const item = document.createElement("div");
    item.className = "dl-item";
    const app = fw.files[2];
    const merged = app.path.replace(/\.bin$/, "-merged.bin");
    item.innerHTML = `
      <div>
        <div class="dl-name">${fw.name}</div>
        <div class="dl-sub">${app.name}</div>
      </div>
      <div class="dl-links">
        <a class="dl-link" href="${app.path}" download>app</a>
        <a class="dl-link" href="${fw.files[0].path}" download>boot</a>
        <a class="dl-link" href="${fw.files[1].path}" download>part</a>
        <a class="dl-link" href="${merged}" download>merged</a>
      </div>`;
    downloadList.appendChild(item);
  });
}

/* ==================================================================
 * 12. BOOT
 * ================================================================== */
initVersionSelector();
initExprGrid();
initDownloadList();
requestAnimationFrame(previewLoop);

appendLog("🍡 MOCHI S3 Web Flasher đã sẵn sàng.", "pink-text");
appendLog("   • Bước 1: cắm cáp USB-C vào Mochi rồi bấm “Kết nối cổng COM”.");
appendLog("   • Bước 2: chọn đúng phiên bản firmware theo board + kích thước màn hình.");
appendLog("   • Bước 3: bấm FLASH, đợi 100%, rồi Reset Chip.");
