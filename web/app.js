async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function log(message) {
  const el = document.getElementById("log");
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.textContent = el.textContent ? `${line}\n${el.textContent}` : line;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

async function refresh() {
  const status = await request("/api/status");
  const deployed = Boolean(status.deployed);
  setText("status-badge", deployed ? "Listo" : "Sin desplegar");
  setText("total-assets", deployed ? status.totalAssets : "-");
  setText("total-supply", deployed ? status.totalSupply : "-");
  setText("paused", deployed ? String(status.paused) : "-");
  setText("fee-recipient", deployed ? status.feeRecipient : "-");
  setText("entry-fee", deployed ? status.entryFeeBps : "-");
  setText("deposit-cap", deployed ? status.depositCap : "-");
  setText("pps", deployed ? status.pricePerShare : "-");

  setText("wallet-address", deployed ? status.deployer : "-");
  setText("wallet-asset-balance", deployed ? status.userAssetBalance : "-");
  setText("wallet-share-balance", deployed ? status.userShareBalance : "-");
  setText("wallet-position-value", deployed ? status.userPositionValue : "-");
  setText("wallet-deposited", deployed ? status.walletDepositedAssets : "-");
  setText("wallet-withdrawn", deployed ? status.walletWithdrawnAssets : "-");
  setText("wallet-realized-pnl", deployed ? status.walletRealizedPnL : "-");
  setText("wallet-current-value", deployed ? status.userCurrentValue : "-");

  setText("fee-recipient-address", deployed ? status.feeRecipient : "-");
  setText("fee-recipient-asset-balance", deployed ? status.feeRecipientAssetBalance : "-");
  setText("fee-recipient-share-balance", deployed ? status.feeRecipientShareBalance : "-");
  setText("fee-recipient-position-value", deployed ? status.feeRecipientPositionValue : "-");
  log(deployed ? `Estado actualizado. Vault en ${status.vault}` : "Estado actualizado. Aun no hay despliegue local.");
}

async function bindButton(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      const result = await action();
      if (result?.txHash) {
        log(`${id}: tx ${result.txHash}`);
      }
      if (result?.walletDepositedAssets || result?.walletWithdrawnAssets) {
        log(
          `${id}: aportado ${result.walletDepositedAssets || "-"}, retirado ${result.walletWithdrawnAssets || "-"}, ganancia realizada ${result.walletRealizedPnL || "-"}`
        );
      }
      if (result?.expectedAssets) {
        log(`${id}: retiraste aproximadamente ${result.expectedAssets}`);
      }
      await refresh();
    } catch (error) {
      log(`${id}: ${error.message}`);
    }
  });
}

bindButton("deploy", async () => {
  const feeRecipient = document.getElementById("deploy-fee-recipient").value.trim();
  const entryFeeBpsRaw = document.getElementById("deploy-entry-fee").value;
  const depositCapRaw = document.getElementById("deploy-cap").value;

  const body = {};
  if (feeRecipient) {
    body.feeRecipient = feeRecipient;
  }
  if (entryFeeBpsRaw !== "") {
    body.entryFeeBps = Number(entryFeeBpsRaw);
  }
  if (depositCapRaw !== "") {
    body.depositCap = Number(depositCapRaw);
  }

  return request("/api/deploy", { method: "POST", body: JSON.stringify(body) });
});
bindButton("deposit", async () => {
  const raw = document.getElementById("deposit-amount").value;
  const amount = raw && !isNaN(Number(raw)) ? Number(raw) : 100;
  return request("/api/deposit", { method: "POST", body: JSON.stringify({ amount }) });
});
bindButton("yield", async () => {
  const raw = document.getElementById("yield-amount").value;
  const amount = raw && !isNaN(Number(raw)) ? Number(raw) : 50;
  return request("/api/yield", { method: "POST", body: JSON.stringify({ amount }) });
});
bindButton("redeem", async () => {
  const raw = document.getElementById("redeem-shares").value;
  const shares = raw && !isNaN(Number(raw)) ? Number(raw) : 50;
  return request("/api/redeem", { method: "POST", body: JSON.stringify({ shares }) });
});
bindButton("pause", async () => request("/api/pause", { method: "POST" }));
bindButton("unpause", async () => request("/api/unpause", { method: "POST" }));
bindButton("cap", async () => {
  const raw = document.getElementById("cap-value").value;
  const cap = raw && !isNaN(Number(raw)) ? Number(raw) : 1000;
  return request("/api/cap", { method: "POST", body: JSON.stringify({ cap }) });
});
document.getElementById("refresh").addEventListener("click", () => refresh().catch((error) => log(error.message)));

refresh().catch((error) => log(error.message));