const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { baseAccounts } = require("./helpers");

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

async function deployFixture() {
  const { deployer, alice, bob } = await baseAccounts();

  const vaultFactory = await ethers.getContractFactory("ERC7535Vault");
  const vault = await vaultFactory.deploy();
  await vault.waitForDeployment();

  return { deployer, alice, bob, vault };
}

describe("ERC7535Vault (native ETH vault)", function () {
  it("uses the ETH sentinel address as asset", async function () {
    const { vault } = await loadFixture(deployFixture);
    expect(await vault.asset()).to.equal(ETH_SENTINEL);
  });

  it("mints shares 1:1 on first deposit via msg.value", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("1");

    await expect(vault.connect(alice).deposit(0, alice.address, { value: amount }))
      .to.emit(vault, "Deposit")
      .withArgs(alice.address, alice.address, amount, amount);

    expect(await vault.balanceOf(alice.address)).to.equal(amount);
    expect(await vault.totalAssets()).to.equal(amount);
  });

  it("refunds excess ETH sent to mint", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    const shares = ethers.parseEther("1");

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await vault.connect(alice).mint(shares, alice.address, { value: shares * 2n });
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(await vault.balanceOf(alice.address)).to.equal(shares);
    expect(before - after - gasCost).to.equal(shares);
  });

  it("returns ETH on withdraw", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("1");
    await vault.connect(alice).deposit(0, alice.address, { value: amount });

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await vault.connect(alice).withdraw(amount, alice.address, alice.address);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(after - before + gasCost).to.equal(amount);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("reports consistent conversions and preview functions", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("1");
    await vault.connect(alice).deposit(0, alice.address, { value: amount });

    expect(await vault.convertToShares(amount)).to.equal(await vault.convertToAssets(amount));
    expect(await vault.previewWithdraw(amount)).to.equal(await vault.previewRedeem(amount));
    expect(await vault.maxWithdraw(alice.address)).to.equal(amount);
    expect(await vault.maxRedeem(alice.address)).to.equal(amount);
  });

  it("reverts mint if msg.value is not enough", async function () {
    const { alice, vault } = await loadFixture(deployFixture);
    const shares = ethers.parseEther("1");
    await expect(
      vault.connect(alice).mint(shares, alice.address, { value: shares - 1n })
    ).to.be.revertedWithCustomError(vault, "ERC7535InsufficientPayment");
  });

  it("reverts withdraw/redeem above the owner's balance", async function () {
    const { alice, bob, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("1");
    await vault.connect(alice).deposit(0, alice.address, { value: amount });

    await expect(
      vault.connect(bob).withdraw(amount, bob.address, bob.address)
    ).to.be.revertedWithCustomError(vault, "ERC7535ExceededMaxWithdraw");
    await expect(
      vault.connect(bob).redeem(amount, bob.address, bob.address)
    ).to.be.revertedWithCustomError(vault, "ERC7535ExceededMaxRedeem");
  });

  it("lets an approved spender withdraw on behalf of the owner", async function () {
    const { alice, bob, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("1");
    await vault.connect(alice).deposit(0, alice.address, { value: amount });

    const shares = await vault.previewWithdraw(amount);
    await vault.connect(alice).approve(bob.address, shares);

    await vault.connect(bob).withdraw(amount, bob.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });
});
