const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { asUnits, deployMockAsset, baseAccounts } = require("./helpers");

async function deployFixture() {
  const { deployer, alice, bob } = await baseAccounts();
  const asset = await deployMockAsset("Mock USD", "mUSD");

  const vaultFactory = await ethers.getContractFactory("ERC5143Vault");
  const vault = await vaultFactory.deploy(await asset.getAddress());
  await vault.waitForDeployment();

  await asset.mint(alice.address, asUnits(1_000));

  return { deployer, alice, bob, asset, vault };
}

describe("ERC5143Vault (slippage protection)", function () {
  it("reverts deposit if minShares is not met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);

    const expectedShares = await vault.previewDeposit(amount);
    await expect(
      vault.connect(alice)["deposit(uint256,address,uint256)"](amount, alice.address, expectedShares + 1n)
    ).to.be.revertedWithCustomError(vault, "ERC5143DepositSlippage");
  });

  it("accepts deposit when minShares is met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);

    const expectedShares = await vault.previewDeposit(amount);
    await vault.connect(alice)["deposit(uint256,address,uint256)"](amount, alice.address, expectedShares);

    expect(await vault.balanceOf(alice.address)).to.equal(expectedShares);
  });

  it("reverts redeem if minAssets is not met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice)["deposit(uint256,address)"](amount, alice.address);

    const shares = await vault.balanceOf(alice.address);
    const expectedAssets = await vault.previewRedeem(shares);
    await expect(
      vault
        .connect(alice)
        ["redeem(uint256,address,address,uint256)"](shares, alice.address, alice.address, expectedAssets + 1n)
    ).to.be.revertedWithCustomError(vault, "ERC5143RedeemSlippage");
  });

  it("accepts redeem when minAssets is met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice)["deposit(uint256,address)"](amount, alice.address);

    const shares = await vault.balanceOf(alice.address);
    const expectedAssets = await vault.previewRedeem(shares);
    await vault
      .connect(alice)
      ["redeem(uint256,address,address,uint256)"](shares, alice.address, alice.address, expectedAssets);

    expect(await asset.balanceOf(alice.address)).to.equal(asUnits(1_000));
  });

  it("reverts mint if maxAssets is exceeded", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const shares = asUnits(100);
    const expectedAssets = await vault.previewMint(shares);
    await asset.connect(alice).approve(await vault.getAddress(), expectedAssets);

    await expect(
      vault.connect(alice)["mint(uint256,address,uint256)"](shares, alice.address, expectedAssets - 1n)
    ).to.be.revertedWithCustomError(vault, "ERC5143MintSlippage");
  });

  it("accepts mint when maxAssets is met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const shares = asUnits(100);
    const expectedAssets = await vault.previewMint(shares);
    await asset.connect(alice).approve(await vault.getAddress(), expectedAssets);

    await vault.connect(alice)["mint(uint256,address,uint256)"](shares, alice.address, expectedAssets);
    expect(await vault.balanceOf(alice.address)).to.equal(shares);
  });

  it("reverts withdraw if maxShares is exceeded", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice)["deposit(uint256,address)"](amount, alice.address);

    const expectedShares = await vault.previewWithdraw(amount);
    await expect(
      vault
        .connect(alice)
        ["withdraw(uint256,address,address,uint256)"](amount, alice.address, alice.address, expectedShares - 1n)
    ).to.be.revertedWithCustomError(vault, "ERC5143WithdrawSlippage");
  });

  it("accepts withdraw when maxShares is met", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice)["deposit(uint256,address)"](amount, alice.address);

    const expectedShares = await vault.previewWithdraw(amount);
    await vault
      .connect(alice)
      ["withdraw(uint256,address,address,uint256)"](amount, alice.address, alice.address, expectedShares);

    expect(await asset.balanceOf(alice.address)).to.equal(asUnits(1_000));
  });
});
