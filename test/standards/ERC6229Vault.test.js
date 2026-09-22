const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { asUnits, deployMockAsset, baseAccounts } = require("./helpers");

async function deployFixture() {
  const { deployer, alice, bob } = await baseAccounts();
  const asset = await deployMockAsset("Mock USD", "mUSD");

  const vaultFactory = await ethers.getContractFactory("ERC6229Vault");
  const vault = await vaultFactory.deploy(await asset.getAddress());
  await vault.waitForDeployment();

  await asset.mint(alice.address, asUnits(1_000));

  return { deployer, alice, bob, asset, vault };
}

describe("ERC6229Vault (lock-in period)", function () {
  it("blocks deposits while locked", async function () {
    const { deployer, alice, asset, vault } = await loadFixture(deployFixture);
    await vault.connect(deployer).lock();

    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await expect(vault.connect(alice).deposit(amount, alice.address)).to.be.revertedWithCustomError(
      vault,
      "VaultLocked"
    );
  });

  it("schedules a deposit during lock and settles it after unlock", async function () {
    const { deployer, alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);

    await vault.connect(deployer).lock();
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await expect(vault.connect(alice).scheduleDeposit(amount))
      .to.emit(vault, "ScheduleDeposit")
      .withArgs(alice.address, amount, 1n);

    expect(await vault.getScheduledDeposits(alice.address)).to.equal(amount);
    // Mientras está bloqueado, los activos agendados no cuentan para el precio por share.
    expect(await vault.totalAssets()).to.equal(0n);

    await vault.connect(deployer).unlock();
    await expect(vault.settleDeposits(alice.address))
      .to.emit(vault, "SettleDeposits")
      .withArgs(alice.address, amount, 1n);

    expect(await vault.balanceOf(alice.address)).to.equal(amount);
    expect(await vault.getScheduledDeposits(alice.address)).to.equal(0n);
  });

  it("schedules a redeem during lock and settles it after unlock", async function () {
    const { deployer, alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);

    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice).deposit(amount, alice.address);

    await vault.connect(deployer).lock();
    const shares = await vault.balanceOf(alice.address);
    await expect(vault.connect(alice).scheduleRedeem(shares))
      .to.emit(vault, "ScheduleRedeem")
      .withArgs(alice.address, shares, 1n);

    await vault.connect(deployer).unlock();
    await expect(vault.settleRedemptions(alice.address)).to.emit(vault, "SettleRedemptions");

    expect(await asset.balanceOf(alice.address)).to.equal(asUnits(1_000));
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("blocks mint/withdraw/redeem while locked", async function () {
    const { deployer, alice, asset, vault } = await loadFixture(deployFixture);
    const amount = asUnits(100);
    await asset.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice).deposit(amount, alice.address);
    const shares = await vault.balanceOf(alice.address);

    await vault.connect(deployer).lock();

    await expect(vault.connect(alice).mint(shares, alice.address)).to.be.revertedWithCustomError(
      vault,
      "VaultLocked"
    );
    await expect(vault.connect(alice).withdraw(amount, alice.address, alice.address)).to.be.revertedWithCustomError(
      vault,
      "VaultLocked"
    );
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address)).to.be.revertedWithCustomError(
      vault,
      "VaultLocked"
    );
  });

  it("only the owner can lock/unlock", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    await expect(vault.connect(alice).lock()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("reverts lock() if already locked and unlock() if already unlocked", async function () {
    const { deployer, vault } = await loadFixture(deployFixture);
    await vault.connect(deployer).lock();
    await expect(vault.connect(deployer).lock()).to.be.revertedWithCustomError(vault, "VaultLocked");

    await vault.connect(deployer).unlock();
    await expect(vault.connect(deployer).unlock()).to.be.revertedWithCustomError(vault, "VaultUnlocked");
  });

  it("reverts settling without a scheduled deposit or redemption", async function () {
    const { deployer, alice, vault } = await loadFixture(deployFixture);
    await expect(vault.settleDeposits(alice.address)).to.be.revertedWithCustomError(vault, "NoScheduledDeposit");
    await expect(vault.settleRedemptions(alice.address)).to.be.revertedWithCustomError(
      vault,
      "NoScheduledRedemption"
    );
  });

  it("allows mint/withdraw/redeem directly while unlocked", async function () {
    const { alice, asset, vault } = await loadFixture(deployFixture);
    const shares = asUnits(100);
    const mintCost = await vault.previewMint(shares);
    await asset.connect(alice).approve(await vault.getAddress(), mintCost);
    await vault.connect(alice).mint(shares, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(shares);

    await vault.connect(alice).withdraw(mintCost / 2n, alice.address, alice.address);
    const remainingShares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(remainingShares, alice.address, alice.address);

    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });
});
