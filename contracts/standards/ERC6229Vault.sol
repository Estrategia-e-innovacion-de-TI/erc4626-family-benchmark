// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice ERC-6229 (Draft, Requires: ERC-4626): vault con periodo de bloqueo por rondas
/// @dev Resuelve el caso en que la estrategia subyacente necesita "congelar" el vault (p. ej. mientras
/// se ejecuta off-chain) sin permitir depósitos/retiros a precio indefinido. Mientras `isLocked`, los
/// usuarios solo pueden agendar (`scheduleDeposit`/`scheduleRedeem`); la liquidación real ocurre al
/// desbloquear, usando el precio por share vigente en ese momento (`settleDeposits`/`settleRedemptions`).
/// @dev Riesgo: si quien controla `lock()`/`unlock()` nunca desbloquea, los fondos agendados quedan
/// congelados indefinidamente (riesgo de censura/griefing centrado en ese rol de confianza).
contract ERC6229Vault is ERC4626, Ownable {
    bool public isLocked;
    uint256 public vaultRound;
    uint256 public totalScheduledDeposits;

    mapping(address => uint256) public getScheduledDeposits;
    mapping(address => uint256) public getScheduledRedemptions;

    event ScheduleDeposit(address indexed sender, uint256 assets, uint256 round);
    event ScheduleRedeem(address indexed sender, uint256 shares, uint256 round);
    event SettleDeposits(address indexed depositor, uint256 newShares, uint256 round);
    event SettleRedemptions(address indexed redeemer, uint256 burnShares, uint256 redeemAssets, uint256 round);

    error VaultLocked();
    error VaultUnlocked();
    error NoScheduledDeposit();
    error NoScheduledRedemption();

    constructor(IERC20 asset_) ERC20("ERC6229 Lock-in Vault", "e6229V") ERC4626(asset_) Ownable(msg.sender) {}

    modifier onlyWhenLocked() {
        if (!isLocked) revert VaultUnlocked();
        _;
    }

    modifier onlyWhenUnlocked() {
        if (isLocked) revert VaultLocked();
        _;
    }

    /// @notice Inicia una nueva ronda de bloqueo; deposit/mint/withdraw/redeem quedan deshabilitados
    function lock() external onlyOwner onlyWhenUnlocked {
        isLocked = true;
        vaultRound += 1;
    }

    /// @notice Vuelve a habilitar deposit/mint/withdraw/redeem normales
    function unlock() external onlyOwner onlyWhenLocked {
        isLocked = false;
    }

    // Excluye del cálculo de precio los activos ya recibidos pero cuyas shares aún no se liquidan.
    function totalAssets() public view override returns (uint256) {
        return super.totalAssets() - totalScheduledDeposits;
    }

    function deposit(uint256 assets, address receiver) public override onlyWhenUnlocked returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override onlyWhenUnlocked returns (uint256) {
        return super.mint(shares, receiver);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override onlyWhenUnlocked returns (uint256) {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override onlyWhenUnlocked returns (uint256) {
        return super.redeem(shares, receiver, owner);
    }

    /// @notice Agenda la intención de depositar `assets` mientras el vault está bloqueado
    function scheduleDeposit(uint256 assets) external onlyWhenLocked {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), assets);
        getScheduledDeposits[msg.sender] += assets;
        totalScheduledDeposits += assets;
        emit ScheduleDeposit(msg.sender, assets, vaultRound);
    }

    /// @notice Agenda la intención de redimir `shares` mientras el vault está bloqueado
    function scheduleRedeem(uint256 shares) external onlyWhenLocked {
        _transfer(msg.sender, address(this), shares);
        getScheduledRedemptions[msg.sender] += shares;
        emit ScheduleRedeem(msg.sender, shares, vaultRound);
    }

    /// @notice Liquida el depósito agendado de `depositor` al precio vigente tras desbloquear
    function settleDeposits(address depositor) external onlyWhenUnlocked returns (uint256 newShares) {
        uint256 assets = getScheduledDeposits[depositor];
        if (assets == 0) revert NoScheduledDeposit();

        // Se cotiza ANTES de liberar `assets` de totalScheduledDeposits, para que totalAssets()
        // siga excluyéndolo (igual que ERC4626 cotiza antes de mover el balance real).
        newShares = previewDeposit(assets);

        delete getScheduledDeposits[depositor];
        totalScheduledDeposits -= assets;

        _mint(depositor, newShares);
        emit SettleDeposits(depositor, newShares, vaultRound);
    }

    /// @notice Liquida la redención agendada de `redeemer` al precio vigente tras desbloquear
    function settleRedemptions(
        address redeemer
    ) external onlyWhenUnlocked returns (uint256 burnShares, uint256 redeemAssets) {
        burnShares = getScheduledRedemptions[redeemer];
        if (burnShares == 0) revert NoScheduledRedemption();
        delete getScheduledRedemptions[redeemer];

        redeemAssets = previewRedeem(burnShares);
        _burn(address(this), burnShares);
        SafeERC20.safeTransfer(IERC20(asset()), redeemer, redeemAssets);
        emit SettleRedemptions(redeemer, burnShares, redeemAssets, vaultRound);
    }
}
