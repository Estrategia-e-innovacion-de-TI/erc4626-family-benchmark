const { ethers } = require("hardhat");

const ONE = 10n ** 18n;

function asUnits(value) {
  return BigInt(value) * ONE;
}

async function deployMockAsset(name, symbol) {
  const factory = await ethers.getContractFactory("MockAsset");
  const asset = await factory.deploy(name, symbol);
  await asset.waitForDeployment();
  return asset;
}

async function baseAccounts() {
  const [deployer, alice, bob] = await ethers.getSigners();
  return { deployer, alice, bob };
}

module.exports = { ONE, asUnits, deployMockAsset, baseAccounts };
