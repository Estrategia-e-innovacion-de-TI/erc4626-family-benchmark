const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { asUnits, deployMockAsset, baseAccounts } = require("./helpers");

async function deployFixture() {
  const { deployer, alice, bob } = await baseAccounts();
  const tokenA = await deployMockAsset("Token A", "TKA");
  const tokenB = await deployMockAsset("Token B", "TKB");

  const shareFactory = await ethers.getContractFactory("ERC7575Share");
  const share = await shareFactory.deploy("Multi-Asset Share", "MAS");
  await share.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("ERC7575Vault");
  const vaultA = await vaultFactory.deploy(await tokenA.getAddress(), await share.getAddress());
  await vaultA.waitForDeployment();
  const vaultB = await vaultFactory.deploy(await tokenB.getAddress(), await share.getAddress());
  await vaultB.waitForDeployment();

  await share.connect(deployer).updateVault(await tokenA.getAddress(), await vaultA.getAddress());
  await share.connect(deployer).updateVault(await tokenB.getAddress(), await vaultB.getAddress());

  await tokenA.mint(alice.address, asUnits(1_000));
  await tokenB.mint(alice.address, asUnits(1_000));

  return { deployer, alice, bob, tokenA, tokenB, share, vaultA, vaultB };
}

describe("ERC7575Vault (multi-asset vault)", function () {
  it("registers each vault as the entry point for its asset", async function () {
    const { tokenA, tokenB, share, vaultA, vaultB } = await loadFixture(deployFixture);
    expect(await share.vault(await tokenA.getAddress())).to.equal(await vaultA.getAddress());
    expect(await share.vault(await tokenB.getAddress())).to.equal(await vaultB.getAddress());
  });

  it("mints the same share token regardless of the entry vault", async function () {
    const { alice, tokenA, tokenB, share, vaultA, vaultB } = await loadFixture(deployFixture);
    const amount = asUnits(100);

    await tokenA.connect(alice).approve(await vaultA.getAddress(), amount);
    await vaultA.connect(alice).deposit(amount, alice.address);

    await tokenB.connect(alice).approve(await vaultB.getAddress(), amount);
    await vaultB.connect(alice).deposit(amount, alice.address);

    expect(await share.balanceOf(alice.address)).to.equal(amount * 2n);
  });

  it("lets a vault redeem shares back into its own asset", async function () {
    const { alice, tokenA, share, vaultA } = await loadFixture(deployFixture);
    const amount = asUnits(100);

    await tokenA.connect(alice).approve(await vaultA.getAddress(), amount);
    await vaultA.connect(alice).deposit(amount, alice.address);

    const shares = await share.balanceOf(alice.address);
    await vaultA.connect(alice).redeem(shares, alice.address, alice.address);

    expect(await tokenA.balanceOf(alice.address)).to.equal(asUnits(1_000));
    expect(await share.balanceOf(alice.address)).to.equal(0n);
  });

  it("exposes the ERC-165 interface ids from the spec", async function () {
    const { share, vaultA } = await loadFixture(deployFixture);
    expect(await vaultA.supportsInterface("0x2f0a18c5")).to.equal(true);
    expect(await share.supportsInterface("0xf815c03d")).to.equal(true);
  });

  it("supports mint() as an alternative entry point", async function () {
    const { alice, tokenA, share, vaultA } = await loadFixture(deployFixture);
    const shares = asUnits(50);
    const expectedAssets = await vaultA.previewMint(shares);
    await tokenA.connect(alice).approve(await vaultA.getAddress(), expectedAssets);

    await vaultA.connect(alice).mint(shares, alice.address);
    expect(await share.balanceOf(alice.address)).to.equal(shares);
    expect(await vaultA.maxDeposit(alice.address)).to.equal(ethers.MaxUint256);
    expect(await vaultA.maxMint(alice.address)).to.equal(ethers.MaxUint256);
  });

  it("reverts withdraw/redeem above the owner's share balance", async function () {
    const { alice, bob, tokenA, vaultA } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await tokenA.connect(alice).approve(await vaultA.getAddress(), amount);
    await vaultA.connect(alice).deposit(amount, alice.address);

    await expect(
      vaultA.connect(bob).withdraw(amount, bob.address, bob.address)
    ).to.be.revertedWithCustomError(vaultA, "ERC7575ExceededMaxWithdraw");
    await expect(
      vaultA.connect(bob).redeem(amount, bob.address, bob.address)
    ).to.be.revertedWithCustomError(vaultA, "ERC7575ExceededMaxRedeem");
  });

  it("lets an approved spender redeem shares on behalf of the owner", async function () {
    const { alice, bob, tokenA, share, vaultA } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await tokenA.connect(alice).approve(await vaultA.getAddress(), amount);
    await vaultA.connect(alice).deposit(amount, alice.address);

    const shares = await share.balanceOf(alice.address);
    await share.connect(alice).approve(await vaultA.getAddress(), shares);

    await vaultA.connect(bob).redeem(shares, bob.address, alice.address);
    expect(await tokenA.balanceOf(bob.address)).to.equal(amount);
  });

  it("exposes convertToShares/convertToAssets and previewWithdraw as views", async function () {
    const { alice, tokenA, vaultA } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await tokenA.connect(alice).approve(await vaultA.getAddress(), amount);
    await vaultA.connect(alice).deposit(amount, alice.address);

    expect(await vaultA.convertToShares(amount)).to.equal(await vaultA.convertToAssets(amount));
    expect(await vaultA.previewWithdraw(amount)).to.equal(amount);

    await vaultA.connect(alice).withdraw(amount, alice.address, alice.address);
    expect(await tokenA.balanceOf(alice.address)).to.equal(asUnits(1_000));
  });
});
