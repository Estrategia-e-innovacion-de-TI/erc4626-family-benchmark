const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { ethers } = require("hardhat");

const ONE = 10n ** 18n;

function formatUnits(value) {
  return ethers.formatUnits(value, 18);
}

async function pause(rl, message) {
  // Sin TTY (ej. corrido desde un runner automatizado) no hay a quien pedirle Enter; solo continúa.
  if (!input.isTTY) {
    console.log(message.trim());
    return;
  }

  await rl.question(`\n${message}`);
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const [deployer, alice] = await ethers.getSigners();

  console.log("Demo interactiva ERC-4626\n");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Alice:    ${alice.address}`);

  const assetFactory = await ethers.getContractFactory("MockAsset");
  const asset = await assetFactory.deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("TokenizedVault");
  const vault = await vaultFactory.deploy(await asset.getAddress(), deployer.address, 0, ethers.MaxUint256);
  await vault.waitForDeployment();

  const yieldFactory = await ethers.getContractFactory("MockYieldSource");
  const yieldSource = await yieldFactory.deploy(await asset.getAddress());
  await yieldSource.waitForDeployment();

  const initialDeposit = 100n * ONE;
  const yieldAmount = 50n * ONE;
  const secondDeposit = 100n * ONE;

  await asset.mint(alice.address, 1_000n * ONE);
  await asset.mint(await yieldSource.getAddress(), 1_000n * ONE);

  console.log(`\nAsset: ${await asset.getAddress()}`);
  console.log(`Vault: ${await vault.getAddress()}`);
  console.log(`Yield source: ${await yieldSource.getAddress()}`);

  await pause(rl, "\nPulsa Enter para hacer el primer depósito de 100 mUSD...");
  await asset.connect(alice).approve(await vault.getAddress(), initialDeposit);
  await vault.connect(alice).deposit(initialDeposit, alice.address);

  console.log(`Shares de Alice: ${formatUnits(await vault.balanceOf(alice.address))}`);
  console.log(`Assets del vault: ${formatUnits(await vault.totalAssets())}`);
  console.log(`Precio implícito por share: ${formatUnits(await vault.convertToAssets(ONE))} assets por share`);

  await pause(rl, "\nPulsa Enter para simular 50 mUSD de rentabilidad entrando al vault...");
  await yieldSource.connect(deployer).fundVault(await vault.getAddress(), yieldAmount);

  console.log(`Assets del vault tras yield: ${formatUnits(await vault.totalAssets())}`);
  console.log(`Un share ahora representa: ${formatUnits(await vault.convertToAssets(ONE))} assets`);

  await pause(rl, "\nPulsa Enter para hacer un segundo depósito de 100 mUSD...");
  await asset.connect(alice).approve(await vault.getAddress(), secondDeposit);
  const previewShares = await vault.previewDeposit(secondDeposit);
  await vault.connect(alice).deposit(secondDeposit, alice.address);

  console.log(`Shares estimadas para el segundo depósito: ${formatUnits(previewShares)}`);
  console.log(`Shares totales de Alice: ${formatUnits(await vault.balanceOf(alice.address))}`);
  console.log(`Supply total de shares: ${formatUnits(await vault.totalSupply())}`);
  console.log(`Assets totales del vault: ${formatUnits(await vault.totalAssets())}`);

  await pause(rl, "\nPulsa Enter para redimir 50 shares y ver cuánto assets salen...");
  const redeemShares = 50n * ONE;
  const expectedAssets = await vault.previewRedeem(redeemShares);
  const balanceBefore = await asset.balanceOf(alice.address);
  await vault.connect(alice).redeem(redeemShares, alice.address, alice.address);
  const balanceAfter = await asset.balanceOf(alice.address);

  console.log(`Assets esperados por 50 shares: ${formatUnits(expectedAssets)}`);
  console.log(`Balance de Alice antes: ${formatUnits(balanceBefore)}`);
  console.log(`Balance de Alice después: ${formatUnits(balanceAfter)}`);
  console.log(`Shares restantes de Alice: ${formatUnits(await vault.balanceOf(alice.address))}`);
  console.log(`Assets finales del vault: ${formatUnits(await vault.totalAssets())}`);

  await pause(rl, "\nDemostración terminada. Pulsa Enter para salir...");
  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});