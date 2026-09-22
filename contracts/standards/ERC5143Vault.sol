// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice ERC-5143 (Stagnant, Requires: ERC-4626): añade protección de slippage a deposit/mint/withdraw/redeem
/// @dev Resuelve el problema que el propio ERC-4626 deja abierto: entre que un EOA firma la tx y esta se mina,
/// el precio por share puede cambiar (front-running/slippage) y no hay forma nativa de revertir si el resultado
/// ya no es aceptable. Aquí se añaden overloads con límites explícitos, sin tocar el comportamiento base.
/// @dev Riesgo: el límite protege el resultado de ESTA tx, pero no impide que otra tx del mismo bloque
/// mueva el precio antes; sigue dependiendo de que el usuario elija un límite realista.
contract ERC5143Vault is ERC4626 {
    error ERC5143DepositSlippage(uint256 shares, uint256 minShares);
    error ERC5143MintSlippage(uint256 assets, uint256 maxAssets);
    error ERC5143WithdrawSlippage(uint256 shares, uint256 maxShares);
    error ERC5143RedeemSlippage(uint256 assets, uint256 minAssets);

    constructor(IERC20 asset_) ERC20("ERC5143 Slippage Vault", "e5143V") ERC4626(asset_) {}

    /// @notice Overload de `deposit` que revierte si se reciben menos de `minShares`
    function deposit(uint256 assets, address receiver, uint256 minShares) external returns (uint256 shares) {
        shares = deposit(assets, receiver);
        if (shares < minShares) revert ERC5143DepositSlippage(shares, minShares);
    }

    /// @notice Overload de `mint` que revierte si el costo supera `maxAssets`
    function mint(uint256 shares, address receiver, uint256 maxAssets) external returns (uint256 assets) {
        assets = mint(shares, receiver);
        if (assets > maxAssets) revert ERC5143MintSlippage(assets, maxAssets);
    }

    /// @notice Overload de `withdraw` que revierte si se queman más de `maxShares`
    function withdraw(
        uint256 assets,
        address receiver,
        address owner,
        uint256 maxShares
    ) external returns (uint256 shares) {
        shares = withdraw(assets, receiver, owner);
        if (shares > maxShares) revert ERC5143WithdrawSlippage(shares, maxShares);
    }

    /// @notice Overload de `redeem` que revierte si se reciben menos de `minAssets`
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256 minAssets
    ) external returns (uint256 assets) {
        assets = redeem(shares, receiver, owner);
        if (assets < minAssets) revert ERC5143RedeemSlippage(assets, minAssets);
    }
}
