// Krishnala Wallet — Chrome extension (MV3). Pre-configured testnet + mainnet.
const NETS = {
  testnet: { name: "Krishnala Testnet", chainId: 713714, rpc: "https://rpc.krishnala.com", faucet: "https://faucet.krishnala.com/api/faucet", live: true },
  mainnet: { name: "Krishnala Mainnet", chainId: 713715, rpc: "https://rpc-mainnet.krishnala.com", faucet: null, live: false }
};
const $ = id => document.getElementById(id);
let pk = null, addr = null; // pk lives only in memory while the popup is open; never written to the DOM

// ---- Key encryption at rest: PBKDF2-SHA256 (600k) -> AES-256-GCM ----
const ITER = 600000, enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptPk(privkey, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(pw, salt, ITER), enc.encode(privkey));
  return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptPk(vault, pw) {
  const key = await deriveKey(pw, unb64(vault.salt), vault.iter || ITER);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) }, key, unb64(vault.ct)));
}
function checkPw(pw) { if (!pw || pw.length < 8) { msg("Password min 8 characters"); return false; } return true; }

function msg(t, ok) { const m = $("msg"); m.style.color = ok ? "#33e1a1" : "#f88"; m.textContent = t; }
function net() { return NETS[$("net").value]; }
function provider() { return new ethers.JsonRpcProvider(net().rpc); }

async function load() {
  const s = await chrome.storage.local.get(["vault", "addr", "pk"]);
  ["setup", "unlock", "main"].forEach(id => $(id).classList.add("hide"));
  if (s.vault) { addr = s.addr || null; $("unlock").classList.remove("hide"); if (s.pk) $("legacy").classList.remove("hide"); }
  else if (s.pk) { $("unlock").classList.remove("hide"); $("legacy").classList.remove("hide"); } // legacy plaintext key: set a password to encrypt it
  else $("setup").classList.remove("hide");
}
async function unlock() {
  const pw = $("unlockpw").value; $("unlockpw").value = "";
  const s = await chrome.storage.local.get(["vault", "pk"]);
  try {
    if (s.vault) pk = await decryptPk(s.vault, pw);
    else if (s.pk) { if (!checkPw(pw)) return; await saveWallet(s.pk, pw); return; } // migrate legacy
    else return;
  } catch { return msg("Wrong password"); }
  if (s.pk) await chrome.storage.local.remove("pk"); // drop any leftover plaintext copy
  addr = new ethers.Wallet(pk).address; showMain(); refresh();
}
function showMain() {
  ["setup", "unlock"].forEach(id => $(id).classList.add("hide")); $("main").classList.remove("hide");
  $("addr").textContent = addr;
}
async function saveWallet(privkey, pw) {
  const w = new ethers.Wallet(privkey);
  const vault = await encryptPk(w.privateKey, pw);
  await chrome.storage.local.set({ vault, addr: w.address });
  await chrome.storage.local.remove("pk");
  pk = w.privateKey; addr = w.address;
  showMain(); refresh();
}
async function refresh() {
  msg("", true);
  try {
    const b = await provider().getBalance(addr);
    $("balance").textContent = (+ethers.formatEther(b)).toFixed(4);
  } catch (e) { msg("RPC error: " + (net().live ? e.message : "mainnet belum live / not live yet")); $("balance").textContent = "—"; }
}

function newPw() { const a = $("newpw").value, b = $("newpw2").value; if (!checkPw(a)) return null; if (a !== b) { msg("Passwords do not match"); return null; } $("newpw").value = $("newpw2").value = ""; return a; }
$("create").onclick = async () => { const pw = newPw(); if (!pw) return; const w = ethers.Wallet.createRandom(); await saveWallet(w.privateKey, pw); msg("Wallet created — backup your key (Copy key)!", true); };
$("import").onclick = async () => { const v = $("importpk").value.trim(); try { new ethers.Wallet(v); } catch { return msg("Invalid private key"); } const pw = newPw(); if (!pw) return; $("importpk").value = ""; await saveWallet(v, pw); };
$("unlockbtn").onclick = unlock;
$("unlockpw").onkeydown = e => { if (e.key === "Enter") unlock(); };
$("lock").onclick = () => { pk = null; load(); };
$("refresh").onclick = refresh;
$("net").onchange = refresh;
$("addr").onclick = () => { navigator.clipboard.writeText(addr); msg("Address copied", true); };
// Export: re-confirm password, copy key to clipboard (never rendered in the DOM), auto-clear clipboard after 30s
$("showpk").onclick = async () => {
  const pw = prompt("Enter wallet password to copy your private key"); if (!pw) return;
  const { vault } = await chrome.storage.local.get("vault");
  let k; try { k = await decryptPk(vault, pw); } catch { return msg("Wrong password"); }
  await navigator.clipboard.writeText(k); k = null;
  msg("⚠ Private key copied — paste it somewhere safe. Clipboard clears in 30s.", true);
  setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30000);
};

$("faucet").onclick = async () => {
  const n = net(); if (!n.faucet) return msg("Faucet only on testnet");
  msg("Requesting faucet...", true);
  try {
    const r = await fetch(n.faucet, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }) });
    const d = await r.json();
    if (d.ok) { msg("✅ Got 10 KRIS!", true); setTimeout(refresh, 4000); } else msg("⚠ " + d.error);
  } catch (e) { msg("Faucet error: " + e.message); }
};

$("send").onclick = async () => {
  const to = $("to").value.trim(), amt = $("amt").value.trim();
  if (!to || !amt) return msg("Fill to + amount");
  msg("Sending...", true);
  try {
    const w = new ethers.Wallet(pk, provider());
    const tx = await w.sendTransaction({ to, value: ethers.parseEther(amt) });
    msg("✅ Sent! " + tx.hash.slice(0, 16) + "...", true);
    setTimeout(refresh, 4000);
  } catch (e) { msg("Send failed: " + (e.shortMessage || e.message)); }
};

$("addmm").onclick = async () => {
  const n = net();
  if (!window.ethereum) return msg("MetaMask not detected");
  try {
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
      chainId: "0x" + n.chainId.toString(16), chainName: n.name,
      rpcUrls: [n.rpc], nativeCurrency: { name: "KRIS", symbol: "KRIS", decimals: 18 },
      blockExplorerUrls: ["https://explorer.krishnala.com"]
    }] });
    msg("Added to MetaMask", true);
  } catch (e) { msg("MetaMask: " + e.message); }
};

load();
