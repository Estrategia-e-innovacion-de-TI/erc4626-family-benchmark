const express = require("express");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ethers } = require("ethers");

const ONE = 10n ** 18n;
const PORT = Number(process.env.WEB_PORT || 3000);
const HARDHAT_PRIVATE_KEY =
  process.env.WEB_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.WEB_RPC_URL || "http://127.0.0.1:8545";
const DEPLOYMENT_PATH = path.join(__dirname, "..", "deployments", "localhost.json");
const METRICS_PATH = path.join(__dirname, "..", "deployments", "localhost.metrics.json");

function readArtifact(relativePath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", relativePath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

const ABIS = {
  asset: readArtifact(path.join("contracts", "MockAsset.sol", "MockAsset.json")),
  vault: readArtifact(path.join("contracts", "TokenizedVault.sol", "TokenizedVault.json")),
  yieldSource: readArtifact(path.join("contracts", "MockYieldSource.sol", "MockYieldSource.json")),
};

function format(value) {
  return ethers.formatUnits(value, 18);
}

function formatSigned(value) {
  const bigint = BigInt(value);
  return bigint < 0n ? `-${format(-bigint)}` : format(bigint);
}

function toBigInt(value) {
  return BigInt(value) * ONE;
}

function emptyMetrics() {
  return {
    walletDepositedAssets: 0n,
    walletWithdrawnAssets: 0n,
  };
}

function loadMetrics() {
  if (!fs.existsSync(METRICS_PATH)) {
    return emptyMetrics();
  }

  const raw = JSON.parse(fs.readFileSync(METRICS_PATH, "utf8"));
  return {
    walletDepositedAssets: BigInt(raw.walletDepositedAssets || 0),
    walletWithdrawnAssets: BigInt(raw.walletWithdrawnAssets || 0),
  };
}

function saveMetrics(metrics) {
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  fs.writeFileSync(
    METRICS_PATH,
    JSON.stringify(
      {
        walletDepositedAssets: metrics.walletDepositedAssets.toString(),
        walletWithdrawnAssets: metrics.walletWithdrawnAssets.toString(),
      },
      null,
      2
    )
  );
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

function createContext(deployment) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.NonceManager(new ethers.Wallet(HARDHAT_PRIVATE_KEY, provider));
  const asset = new ethers.Contract(deployment.asset, ABIS.asset, signer);
  const vault = new ethers.Contract(deployment.vault, ABIS.vault, signer);
  const yieldSource = new ethers.Contract(deployment.yieldSource, ABIS.yieldSource, signer);

  return { provider, signer, asset, vault, yieldSource, deployment };
}

async function getStatus() {
  const deployment = loadDeployment();

  if (!deployment) {
    return { deployed: false };
  }

  const { signer, asset, vault } = createContext(deployment);
  const deployerAddress = await signer.getAddress();
  const feeRecipientAddress = await vault.feeRecipient();
  const analytics = loadMetrics();

  const walletAssetBalance = await asset.balanceOf(deployerAddress);
  const walletShareBalance = await vault.balanceOf(deployerAddress);
  const walletPositionValue = await vault.convertToAssets(walletShareBalance);
  const walletCurrentValue = walletAssetBalance + walletPositionValue;

  const feeRecipientAssetBalance = await asset.balanceOf(feeRecipientAddress);
  const feeRecipientShareBalance = await vault.balanceOf(feeRecipientAddress);
  const feeRecipientPositionValue = await vault.convertToAssets(feeRecipientShareBalance);

  const walletRealizedPnL = analytics.walletWithdrawnAssets - analytics.walletDepositedAssets;
  const walletNetInvested = analytics.walletDepositedAssets - analytics.walletWithdrawnAssets;

  return {
    deployed: true,
    deployer: deployerAddress,
    asset: deployment.asset,
    vault: deployment.vault,
    yieldSource: deployment.yieldSource,
    feeRecipient: feeRecipientAddress,
    entryFeeBps: (await vault.entryFeeBps()).toString(),
    depositCap: (await vault.depositCap()).toString(),
    paused: await vault.paused(),
    totalAssets: format(await vault.totalAssets()),
    totalSupply: format(await vault.totalSupply()),
    pricePerShare: format(await vault.convertToAssets(ONE)),
    userAssetBalance: format(walletAssetBalance),
    userShareBalance: format(walletShareBalance),
    userPositionValue: format(walletPositionValue),
    userCurrentValue: format(walletCurrentValue),
    walletDepositedAssets: format(analytics.walletDepositedAssets),
    walletWithdrawnAssets: format(analytics.walletWithdrawnAssets),
    walletRealizedPnL: formatSigned(walletRealizedPnL),
    walletNetInvested: formatSigned(walletNetInvested),
    feeRecipientAssetBalance: format(feeRecipientAssetBalance),
    feeRecipientShareBalance: format(feeRecipientShareBalance),
    feeRecipientPositionValue: format(feeRecipientPositionValue),
  };
}

async function deployLocalNetwork() {
  fs.mkdirSync(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  execSync("npx hardhat run scripts/deploy-sepolia.js --network localhost", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: process.env,
    shell: true,
  });

  const deployment = loadDeployment();
  if (!deployment) {
    throw new Error("Deployment manifest was not created");
  }

  saveMetrics(emptyMetrics());

  return deployment;
}

function buildDeployEnv(body = {}) {
  const env = { ...process.env };

  if (body.feeRecipient) {
    env.INITIAL_FEE_RECIPIENT = body.feeRecipient;
  }

  if (body.entryFeeBps !== undefined && body.entryFeeBps !== null && body.entryFeeBps !== "") {
    env.INITIAL_ENTRY_FEE_BPS = String(body.entryFeeBps);
  }

  if (body.depositCap !== undefined && body.depositCap !== null && body.depositCap !== "") {
    env.INITIAL_DEPOSIT_CAP = toBigInt(body.depositCap).toString();
  }

  return env;
}

async function withContracts(handler) {
  const deployment = loadDeployment();
  if (!deployment) {
    throw new Error("Primero despliega el vault con el boton 'Redesplegar'.");
  }

  return handler(createContext(deployment));
}

async function bootstrap() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "web")));

  app.get("/api/status", async (_req, res) => {
    try {
      res.json(await getStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/deploy", async (req, res) => {
    try {
      const env = buildDeployEnv(req.body || {});
      execSync("npx hardhat run scripts/deploy-sepolia.js --network localhost", {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        env,
        shell: true,
      });

      const deployment = loadDeployment();
      if (!deployment) {
        throw new Error("Deployment manifest was not created");
      }

      saveMetrics(emptyMetrics());
      res.json(await getStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/deposit", async (req, res) => {
    try {
      const result = await withContracts(async ({ signer, asset, vault, deployment }) => {
        const deployerAddress = await signer.getAddress();
        const amount = toBigInt(req.body.amount || 100);
        const analytics = loadMetrics();

        await (await asset.approve(deployment.vault, amount)).wait();
        const tx = await vault.deposit(amount, deployerAddress);
        const receipt = await tx.wait();

        analytics.walletDepositedAssets += amount;
        saveMetrics(analytics);

        return {
          status: "ok",
          txHash: receipt.hash,
          totalAssets: format(await vault.totalAssets()),
          userShareBalance: format(await vault.balanceOf(deployerAddress)),
          userAssetBalance: format(await asset.balanceOf(deployerAddress)),
          walletDepositedAssets: format(analytics.walletDepositedAssets),
          walletWithdrawnAssets: format(analytics.walletWithdrawnAssets),
          walletRealizedPnL: formatSigned(analytics.walletWithdrawnAssets - analytics.walletDepositedAssets),
        };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/yield", async (req, res) => {
    try {
      const result = await withContracts(async ({ signer, vault, yieldSource, deployment }) => {
        const amount = toBigInt(req.body.amount || 50);
        const tx = await yieldSource.connect(signer).fundVault(deployment.vault, amount);
        const receipt = await tx.wait();

        return {
          status: "ok",
          txHash: receipt.hash,
          totalAssets: format(await vault.totalAssets()),
          pricePerShare: format(await vault.convertToAssets(ONE)),
        };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/redeem", async (req, res) => {
    try {
      const result = await withContracts(async ({ signer, asset, vault }) => {
        const deployerAddress = await signer.getAddress();
        const shares = toBigInt(req.body.shares || 50);
        const analytics = loadMetrics();
        const expectedAssets = await vault.previewRedeem(shares);
        const tx = await vault.redeem(shares, deployerAddress, deployerAddress);
        const receipt = await tx.wait();

        analytics.walletWithdrawnAssets += expectedAssets;
        saveMetrics(analytics);

        return {
          status: "ok",
          txHash: receipt.hash,
          expectedAssets: format(expectedAssets),
          totalAssets: format(await vault.totalAssets()),
          userShareBalance: format(await vault.balanceOf(deployerAddress)),
          userAssetBalance: format(await asset.balanceOf(deployerAddress)),
          walletDepositedAssets: format(analytics.walletDepositedAssets),
          walletWithdrawnAssets: format(analytics.walletWithdrawnAssets),
          walletRealizedPnL: formatSigned(analytics.walletWithdrawnAssets - analytics.walletDepositedAssets),
        };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pause", async (_req, res) => {
    try {
      const result = await withContracts(async ({ vault, signer }) => {
        const tx = await vault.connect(signer).pause();
        const receipt = await tx.wait();
        return { status: "ok", txHash: receipt.hash, paused: await vault.paused() };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  

  app.post("/api/unpause", async (_req, res) => {
    try {
      const result = await withContracts(async ({ vault, signer }) => {
        const tx = await vault.connect(signer).unpause();
        const receipt = await tx.wait();
        return { status: "ok", txHash: receipt.hash, paused: await vault.paused() };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/cap", async (req, res) => {
    try {
      const result = await withContracts(async ({ vault, signer }) => {
        const cap = toBigInt(req.body.cap || 1000);
        const tx = await vault.connect(signer).setDepositCap(cap);
        const receipt = await tx.wait();
        return { status: "ok", txHash: receipt.hash, depositCap: (await vault.depositCap()).toString() };
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Web UI listening on http://127.0.0.1:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});