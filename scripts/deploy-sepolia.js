const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const ONE = 10n ** 18n;

function parseEnvBigInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return BigInt(value);
}

function parseEnvUint(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return Number(value);
}

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  // Use a different default fee recipient (second signer) to avoid
  // crediting the deployer with feeShares by default when testing via UI.
  const defaultFeeRecipient = signers[1] ? signers[1].address : deployer.address;
  const deploymentDir = path.join(__dirname, "..", "deployments");
  const deploymentPath = path.join(deploymentDir, `${network.name}.json`);
  const initialFeeRecipient = process.env.INITIAL_FEE_RECIPIENT || defaultFeeRecipient;
  const initialEntryFeeBps = parseEnvUint(process.env.INITIAL_ENTRY_FEE_BPS, 0);
  const initialDepositCap = parseEnvBigInt(process.env.INITIAL_DEPOSIT_CAP, ethers.MaxUint256);

  console.log(`Deploying with account: ${deployer.address}`);
  console.log(`Initial fee recipient: ${initialFeeRecipient}`);
  console.log(`Initial entry fee bps: ${initialEntryFeeBps}`);
  console.log(
    `Initial deposit cap: ${initialDepositCap === ethers.MaxUint256 ? "unlimited" : initialDepositCap.toString()}`
  );

  const assetFactory = await ethers.getContractFactory("MockAsset");
  const asset = await assetFactory.deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("TokenizedVault");
  const vault = await vaultFactory.deploy(
    await asset.getAddress(),
    initialFeeRecipient,
    initialEntryFeeBps,
    initialDepositCap
  );
  await vault.waitForDeployment();

  const yieldFactory = await ethers.getContractFactory("MockYieldSource");
  const yieldSource = await yieldFactory.deploy(await asset.getAddress());
  await yieldSource.waitForDeployment();

  const seed = 1_000n * ONE;
  await asset.mint(deployer.address, seed);
  await asset.mint(await yieldSource.getAddress(), seed);

  console.log("Deployment completed");
  console.log(`MockAsset:      ${await asset.getAddress()}`);
  console.log(`TokenizedVault:  ${await vault.getAddress()}`);
  console.log(`MockYieldSource: ${await yieldSource.getAddress()}`);
  console.log(`Owner:           ${await vault.owner()}`);
  console.log(`Fee recipient:   ${await vault.feeRecipient()}`);
  console.log(`Entry fee bps:   ${await vault.entryFeeBps()}`);
  console.log(`Deposit cap:     ${await vault.depositCap()}`);

  fs.mkdirSync(deploymentDir, { recursive: true });
  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(
      {
        network: network.name,
        deployer: deployer.address,
        asset: await asset.getAddress(),
        vault: await vault.getAddress(),
        yieldSource: await yieldSource.getAddress(),
        feeRecipient: await vault.feeRecipient(),
        entryFeeBps: (await vault.entryFeeBps()).toString(),
        depositCap: (await vault.depositCap()).toString(),
        initialFeeRecipient,
        initialEntryFeeBps: initialEntryFeeBps.toString(),
        initialDepositCap: initialDepositCap.toString(),
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(deploymentDir, `${network.name}.metrics.json`),
    JSON.stringify(
      {
        walletDepositedAssets: "0",
        walletWithdrawnAssets: "0",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});