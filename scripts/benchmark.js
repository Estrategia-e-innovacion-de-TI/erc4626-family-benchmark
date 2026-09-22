const { ethers } = require("hardhat");

const AMOUNT = ethers.parseEther("100");

// Ficha comparativa: qué se considera "operación equivalente" para cada estándar, dado que sus
// interfaces de entrada/salida no son idénticas (ETH nativo vs ERC-20, share externo vs propio, etc).
const STANDARDS = [
  {
    name: "ERC-4626 (base)",
    eip: 4626,
    status: "Final",
    note: "deposit(assets, receiver) vía approve+transferFrom sobre un ERC-20",
  },
  {
    name: "ERC-5143",
    eip: 5143,
    status: "Stagnant",
    note: "deposit(assets, receiver) sin límite de slippage (mismo costo base + un check extra)",
  },
  {
    name: "ERC-6229",
    eip: 6229,
    status: "Draft",
    note: "deposit(assets, receiver) en estado 'unlocked' (sin agendamiento, camino feliz de ERC-4626)",
  },
  {
    name: "ERC-7535",
    eip: 7535,
    status: "Final",
    note: "deposit(0, receiver){value: assets} pagando en ETH nativo, sin approve/transferFrom",
  },
  {
    name: "ERC-7575",
    eip: 7575,
    status: "Final",
    note: "deposit(assets, receiver) en un Vault de un solo asset + mint en un Share externo",
  },
];

async function gasOf(txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return receipt.gasUsed;
}

async function benchmarkERC4626Base(deployer, user) {
  const asset = await (await ethers.getContractFactory("MockAsset")).deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();
  await asset.mint(user.address, AMOUNT);

  const vault = await (
    await ethers.getContractFactory("TokenizedVault")
  ).deploy(await asset.getAddress(), deployer.address, 0, ethers.MaxUint256);
  await vault.waitForDeployment();

  await asset.connect(user).approve(await vault.getAddress(), AMOUNT);
  const depositGas = await gasOf(vault.connect(user).deposit(AMOUNT, user.address));
  const shares = await vault.balanceOf(user.address);
  const withdrawGas = await gasOf(vault.connect(user).redeem(shares, user.address, user.address));

  return { depositGas, withdrawGas };
}

async function benchmarkERC5143(user) {
  const asset = await (await ethers.getContractFactory("MockAsset")).deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();
  await asset.mint(user.address, AMOUNT);

  const vault = await (await ethers.getContractFactory("ERC5143Vault")).deploy(await asset.getAddress());
  await vault.waitForDeployment();

  await asset.connect(user).approve(await vault.getAddress(), AMOUNT);
  const depositGas = await gasOf(vault.connect(user)["deposit(uint256,address)"](AMOUNT, user.address));
  const shares = await vault.balanceOf(user.address);
  const withdrawGas = await gasOf(vault.connect(user)["redeem(uint256,address,address)"](shares, user.address, user.address));

  return { depositGas, withdrawGas };
}

async function benchmarkERC6229(user) {
  const asset = await (await ethers.getContractFactory("MockAsset")).deploy("Mock USD", "mUSD");
  await asset.waitForDeployment();
  await asset.mint(user.address, AMOUNT);

  const vault = await (await ethers.getContractFactory("ERC6229Vault")).deploy(await asset.getAddress());
  await vault.waitForDeployment();

  await asset.connect(user).approve(await vault.getAddress(), AMOUNT);
  const depositGas = await gasOf(vault.connect(user).deposit(AMOUNT, user.address));
  const shares = await vault.balanceOf(user.address);
  const withdrawGas = await gasOf(vault.connect(user).redeem(shares, user.address, user.address));

  return { depositGas, withdrawGas };
}

async function benchmarkERC7535(user) {
  const vault = await (await ethers.getContractFactory("ERC7535Vault")).deploy();
  await vault.waitForDeployment();

  const depositGas = await gasOf(vault.connect(user).deposit(0, user.address, { value: AMOUNT }));
  const shares = await vault.balanceOf(user.address);
  const withdrawGas = await gasOf(vault.connect(user).redeem(shares, user.address, user.address));

  return { depositGas, withdrawGas };
}

async function benchmarkERC7575(deployer, user) {
  const asset = await (await ethers.getContractFactory("MockAsset")).deploy("Token A", "TKA");
  await asset.waitForDeployment();
  await asset.mint(user.address, AMOUNT);

  const share = await (await ethers.getContractFactory("ERC7575Share")).deploy("Multi-Asset Share", "MAS");
  await share.waitForDeployment();

  const vault = await (
    await ethers.getContractFactory("ERC7575Vault")
  ).deploy(await asset.getAddress(), await share.getAddress());
  await vault.waitForDeployment();
  await share.connect(deployer).updateVault(await asset.getAddress(), await vault.getAddress());

  await asset.connect(user).approve(await vault.getAddress(), AMOUNT);
  const depositGas = await gasOf(vault.connect(user).deposit(AMOUNT, user.address));
  const shares = await share.balanceOf(user.address);
  const withdrawGas = await gasOf(vault.connect(user).redeem(shares, user.address, user.address));

  return { depositGas, withdrawGas };
}

async function main() {
  const [deployer, user] = await ethers.getSigners();

  const runners = [
    () => benchmarkERC4626Base(deployer, user),
    () => benchmarkERC5143(user),
    () => benchmarkERC6229(user),
    () => benchmarkERC7535(user),
    () => benchmarkERC7575(deployer, user),
  ];

  const rows = [];
  for (let i = 0; i < runners.length; i += 1) {
    const { depositGas, withdrawGas } = await runners[i]();
    rows.push({
      Estándar: STANDARDS[i].name,
      EIP: STANDARDS[i].eip,
      Estado: STANDARDS[i].status,
      "Gas depósito": depositGas.toString(),
      "Gas retiro": withdrawGas.toString(),
      "Qué se compara": STANDARDS[i].note,
    });
  }

  console.log("\nBenchmark de gas — familia ERC-4626 (excluye ERC-7540)\n");
  console.log(
    "Nota: cada fila mide una 'operación equivalente' distinta según su propia interfaz; no son la misma función exacta.\n"
  );
  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
