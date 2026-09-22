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
  const status = await request("/api/standards/status");
  const deployed = Boolean(status.deployed);

  setText("e5143-shares", deployed ? status.erc5143.shareBalance : "-");

  setText("e6229-locked", deployed ? String(status.erc6229.isLocked) : "-");
  setText("e6229-round", deployed ? status.erc6229.vaultRound : "-");
  setText("e6229-scheduled", deployed ? status.erc6229.scheduledDeposit : "-");
  setText("e6229-shares", deployed ? status.erc6229.shareBalance : "-");

  setText("e7535-shares", deployed ? status.erc7535.ethShareBalance : "-");
  setText("e7535-vault-balance", deployed ? status.erc7535.vaultEthBalance : "-");

  setText("e7575-shares", deployed ? status.erc7575.sharedShareBalance : "-");
  setText("e7575-token-a", deployed ? status.erc7575.tokenABalance : "-");
  setText("e7575-token-b", deployed ? status.erc7575.tokenBBalance : "-");

  log(deployed ? "Estado del benchmark actualizado." : "Aun no hay benchmark desplegado.");
}

function bindButton(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      const result = await action();
      if (result?.txHash) {
        log(`${id}: tx ${result.txHash}`);
      }
      await refresh();
    } catch (error) {
      log(`${id}: error - ${error.message}`);
    }
  });
}

function amountOf(id, fallback) {
  const raw = document.getElementById(id).value;
  return raw === "" ? fallback : raw;
}

bindButton("deploy", () => request("/api/standards/deploy", { method: "POST" }));

bindButton("e5143-deposit", () =>
  request("/api/standards/5143/deposit", {
    method: "POST",
    body: JSON.stringify({
      amount: amountOf("e5143-amount", 100),
      minShares: amountOf("e5143-min-shares", 0),
    }),
  })
);

bindButton("e6229-lock", () => request("/api/standards/6229/lock", { method: "POST" }));
bindButton("e6229-unlock", () => request("/api/standards/6229/unlock", { method: "POST" }));
bindButton("e6229-schedule", () =>
  request("/api/standards/6229/schedule-deposit", {
    method: "POST",
    body: JSON.stringify({ amount: amountOf("e6229-amount", 100) }),
  })
);
bindButton("e6229-settle", () => request("/api/standards/6229/settle-deposit", { method: "POST" }));

bindButton("e7535-deposit", () =>
  request("/api/standards/7535/deposit", {
    method: "POST",
    body: JSON.stringify({ amount: amountOf("e7535-amount", 1) }),
  })
);

bindButton("e7575-deposit-a", () =>
  request("/api/standards/7575/deposit", {
    method: "POST",
    body: JSON.stringify({ which: "A", amount: amountOf("e7575-amount", 100) }),
  })
);
bindButton("e7575-deposit-b", () =>
  request("/api/standards/7575/deposit", {
    method: "POST",
    body: JSON.stringify({ which: "B", amount: amountOf("e7575-amount", 100) }),
  })
);

document.getElementById("refresh").addEventListener("click", () => refresh().catch((error) => log(`refresh: ${error.message}`)));

refresh().catch((error) => log(`refresh: ${error.message}`));
