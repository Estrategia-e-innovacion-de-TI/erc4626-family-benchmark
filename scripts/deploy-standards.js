const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const ONE = 10n ** 18n;
const SEED = 1_000n * ONE;

async function main() {
  const [deployer] = await ethers.getSigners();
  const deploymentDir = path.join(__dirname, "..", "deployments");
  const deploymentPath = path.join(deploymentDir, `${network.name}.standards.json`);

  const mockAssetFactory = await ethers.getContractFactory("MockAsset");

  const assetSingle = await mockAssetFactory.deploy("Mock USD", "mUSD");
  await assetSingle.waitForDeployment();

  const tokenA = await mockAssetFactory.deploy("Token A", "TKA");
  await tokenA.waitForDeployment();
  const tokenB = await mockAssetFactory.deploy("Token B", "TKB");
  await tokenB.waitForDeployment();

  const erc5143 = await (await ethers.getContractFactory("ERC5143Vault")).deploy(await assetSingle.getAddress());
  await erc5143.waitForDeployment();

  const erc6229 = await (await ethers.getContractFactory("ERC6229Vault")).deploy(await assetSingle.getAddress());
  await erc6229.waitForDeployment();

  const erc7535 = await (await ethers.getContractFactory("ERC7535Vault")).deploy();
  await erc7535.waitForDeployment();

  const share = await (await ethers.getContractFactory("ERC7575Share")).deploy("Multi-Asset Share", "MAS");
  await share.waitForDeployment();
  const vaultA = await (
    await ethers.getContractFactory("ERC7575Vault")
  ).deploy(await tokenA.getAddress(), await share.getAddress());
  await vaultA.waitForDeployment();
  const vaultB = await (
    await ethers.getContractFactory("ERC7575Vault")
  ).deploy(await tokenB.getAddress(), await share.getAddress());
  await vaultB.waitForDeployment();
  await (await share.updateVault(await tokenA.getAddress(), await vaultA.getAddress())).wait();
  await (await share.updateVault(await tokenB.getAddress(), await vaultB.getAddress())).wait();

  // Semilla de activos de prueba para poder interactuar desde la UI sin pasos manuales extra.
  await (await assetSingle.mint(deployer.address, SEED)).wait();
  await (await tokenA.mint(deployer.address, SEED)).wait();
  await (await tokenB.mint(deployer.address, SEED)).wait();

  console.log("Benchmark de estándares desplegado en", network.name);
  console.log(`ERC-5143 vault: ${await erc5143.getAddress()}`);
  console.log(`ERC-6229 vault: ${await erc6229.getAddress()}`);
  console.log(`ERC-7535 vault: ${await erc7535.getAddress()}`);
  console.log(`ERC-7575 share: ${await share.getAddress()}`);
  console.log(`ERC-7575 vaultA (Token A): ${await vaultA.getAddress()}`);
  console.log(`ERC-7575 vaultB (Token B): ${await vaultB.getAddress()}`);

  fs.mkdirSync(deploymentDir, { recursive: true });
  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(
      {
        network: network.name,
        deployer: deployer.address,
        assetSingle: await assetSingle.getAddress(),
        tokenA: await tokenA.getAddress(),
        tokenB: await tokenB.getAddress(),
        erc5143: await erc5143.getAddress(),
        erc6229: await erc6229.getAddress(),
        erc7535: await erc7535.getAddress(),
        share: await share.getAddress(),
        vaultA: await vaultA.getAddress(),
        vaultB: await vaultB.getAddress(),
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
