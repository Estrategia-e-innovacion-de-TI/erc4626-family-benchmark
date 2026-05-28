const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = 10n ** 18n;

function asUnits(value) {
  return BigInt(value) * ONE;
}

async function deployFixture() {
  const [deployer, alice, bob] = await ethers.getSigners();

  const assetFactory = await ethers.getContractFactory("MockAsset");
  const asset = await assetFactory.deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("TokenizedVault");
  const vault = await vaultFactory.deploy(await asset.getAddress(), deployer.address, 0, ethers.MaxUint256);
  await vault.waitForDeployment();

  const yieldFactory = await ethers.getContractFactory("MockYieldSource");
  const yieldSource = await yieldFactory.deploy(await asset.getAddress());
  await yieldSource.waitForDeployment();

  const seed = asUnits(1_000);
  await asset.mint(alice.address, seed);
  await asset.mint(bob.address, seed);
  await asset.mint(await yieldSource.getAddress(), seed);

  return { deployer, alice, bob, asset, vault, yieldSource };
}

describe("TokenizedVault", function () {
  it("mints shares 1:1 on the first deposit", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);

    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await expect(vault.connect(alice).deposit(amount, alice.address))
      .to.emit(vault, "Deposit")
      .withArgs(alice.address, alice.address, amount, amount);

    expect(await vault.balanceOf(alice.address)).to.equal(amount);
    expect(await vault.totalAssets()).to.equal(amount);
  });

  it("prices new shares against simulated yield", async function () {
    const { alice, asset, vault, yieldSource, deployer } = await loadFixture(deployFixture);
    const firstDeposit = asUnits(100);
    const yieldAmount = asUnits(50);
    const secondDeposit = asUnits(100);

    await asset.connect(alice).approve(await vault.getAddress(), firstDeposit + secondDeposit);
    await vault.connect(alice).deposit(firstDeposit, alice.address);

    await yieldSource.connect(deployer).fundVault(await vault.getAddress(), yieldAmount);

    const expectedShares = await vault.previewDeposit(secondDeposit);
    await expect(vault.connect(alice).deposit(secondDeposit, alice.address))
      .to.emit(vault, "Deposit")
      .withArgs(alice.address, alice.address, secondDeposit, expectedShares);

    expect(await vault.totalAssets()).to.equal(firstDeposit + yieldAmount + secondDeposit);
    expect(await vault.totalSupply()).to.equal(firstDeposit + expectedShares);

    const convertedAssets = await vault.convertToAssets(expectedShares);
    expect(convertedAssets).to.be.lte(secondDeposit);
    expect(secondDeposit - convertedAssets).to.be.lte(1n);
  });

  it("redeems partial shares for the proportional assets after yield", async function () {
    const { alice, asset, vault, yieldSource, deployer } = await loadFixture(deployFixture);
    const depositAmount = asUnits(100);
    const yieldAmount = asUnits(50);

    await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
    await vault.connect(alice).deposit(depositAmount, alice.address);

    await yieldSource.connect(deployer).fundVault(await vault.getAddress(), yieldAmount);

    const redeemShares = asUnits(50);
    const expectedAssets = await vault.previewRedeem(redeemShares);
    const balanceBefore = await asset.balanceOf(alice.address);

    await expect(vault.connect(alice).redeem(redeemShares, alice.address, alice.address))
      .to.emit(vault, "Withdraw")
      .withArgs(alice.address, alice.address, alice.address, expectedAssets, redeemShares);

    expect(await asset.balanceOf(alice.address)).to.equal(balanceBefore + expectedAssets);
    expect(await vault.balanceOf(alice.address)).to.equal(depositAmount - redeemShares);
  });

  it("rounds down small deposits in favor of the vault", async function () {
    const { alice, asset, vault, yieldSource, deployer } = await loadFixture(deployFixture);
    const depositAmount = asUnits(3);
    const yieldAmount = asUnits(1);

    await asset.connect(alice).approve(await vault.getAddress(), depositAmount);
    await vault.connect(alice).deposit(depositAmount, alice.address);

    await yieldSource.connect(deployer).fundVault(await vault.getAddress(), yieldAmount);

    const tinyDeposit = 1n;
    const shares = await vault.previewDeposit(tinyDeposit);

    expect(shares).to.equal(0n);
  });

  it("applies an entry fee by minting fee shares to the recipient", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    await vault.setEntryFeeBps(100);

    const amount = asUnits(100);
    const expectedShares = await vault.previewDeposit(amount);

    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice).deposit(amount, alice.address);

    expect(await vault.balanceOf(alice.address)).to.equal(expectedShares);
    expect(await vault.balanceOf(await vault.feeRecipient())).to.equal(asUnits(1));
  });

  it("blocks deposits when paused and when the cap is reached", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);

    await vault.setDepositCap(asUnits(100));
    await vault.pause();

    await asset.connect(alice).approve(await vault.getAddress(), asUnits(1));
    await expect(vault.connect(alice).deposit(asUnits(1), alice.address)).to.be.reverted;

    await vault.unpause();
    await asset.connect(alice).approve(await vault.getAddress(), asUnits(100));
    await vault.connect(alice).deposit(asUnits(100), alice.address);

    expect(await vault.maxDeposit(alice.address)).to.equal(0n);
  });
});