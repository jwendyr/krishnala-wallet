// Krishnala Wallet — Chrome extension (MV3). Pre-configured testnet + mainnet.
const NETS = {
  testnet: { name: "Krishnala Testnet", chainId: 713714, rpc: "https://rpc.krishnala.com", faucet: "https://faucet.krishnala.com/api/faucet", live: true },
  mainnet: { name: "Krishnala Mainnet", chainId: 713715, rpc: "https://rpc-mainnet.krishnala.com", faucet: null, live: false }
};
const $ = id => document.getElementById(id);
let pk = null, addr = null;

function msg(t, ok) { const m = $("msg"); m.style.color = ok ? "#33e1a1" : "#f88"; m.textContent = t; }
function net() { return NETS[$("net").value]; }
function provider() { return new ethers.JsonRpcProvider(net().rpc); }

async function load() {
  const s = await chrome.storage.local.get("pk");
  pk = s.pk || null;
  if (pk) { addr = new ethers.Wallet(pk).address; showMain(); refresh(); }
  else { $("setup").classList.remove("hide"); $("main").classList.add("hide"); }
}
function showMain() {
  $("setup").classList.add("hide"); $("main").classList.remove("hide");
  $("addr").textContent = addr;
}
async function saveWallet(privkey) {
  pk = privkey; addr = new ethers.Wallet(pk).address;
  await chrome.storage.local.set({ pk });
  showMain(); refresh();
}
async function refresh() {
  msg("", true);
  try {
    const b = await provider().getBalance(addr);
    $("balance").textContent = (+ethers.formatEther(b)).toFixed(4);
  } catch (e) { msg("RPC error: " + (net().live ? e.message : "mainnet belum live / not live yet")); $("balance").textContent = "—"; }
}

$("create").onclick = () => { const w = ethers.Wallet.createRandom(); saveWallet(w.privateKey); msg("Wallet created — backup your key!", true); };
$("import").onclick = () => { const v = $("importpk").value.trim(); try { new ethers.Wallet(v); saveWallet(v); } catch { msg("Invalid private key"); } };
$("refresh").onclick = refresh;
$("net").onchange = refresh;
$("addr").onclick = () => { navigator.clipboard.writeText(addr); msg("Address copied", true); };
$("showpk").onclick = () => { const e = $("pk"); e.classList.toggle("hide"); e.textContent = "⚠ " + pk; };

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
