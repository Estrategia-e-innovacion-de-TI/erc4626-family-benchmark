// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC7575Share} from "./ERC7575Share.sol";

/// @notice ERC-7575 (Final, Requires: ERC-4626): entry point de un solo asset para un `ERC7575Share` externo
/// @dev Implementa ERC-4626 SIN los métodos ERC-20 (que viven en `ERC7575Share`), permitiendo que varios
/// vaults (uno por asset) compartan el mismo token de shares — el caso de uso "multi-asset vault" del EIP.
/// El precio por share se calcula con `totalSharesIssued` local a este vault (no con `share.totalSupply()`
/// global), porque otro vault del mismo share puede manejar un activo de escala totalmente distinta.
/// @dev Riesgo: el balance/supply real de las shares vive en `ERC7575Share`, fuera del control de este
/// contrato; si CUALQUIER vault registrado en ese share es malicioso o tiene un bug, puede mintear/quemar
/// shares arbitrariamente y diluir a todos los holders, sin que este vault pueda evitarlo.
contract ERC7575Vault {
    using Math for uint256;

    IERC20 private immutable _asset;
    ERC7575Share public immutable share;

    // Precio calculado de forma local a este vault (no usa share.totalSupply() global), porque
    // otro vault que comparta el mismo Share puede tener una escala de activos totalmente distinta.
    uint256 public totalSharesIssued;

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    error ERC7575ExceededMaxWithdraw(address owner, uint256 assets, uint256 max);
    error ERC7575ExceededMaxRedeem(address owner, uint256 shares, uint256 max);

    constructor(IERC20 asset_, ERC7575Share share_) {
        _asset = asset_;
        share = share_;
    }

    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalAssets() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor);
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return previewRedeem(share.balanceOf(owner));
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return share.balanceOf(owner);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = previewDeposit(assets);
        totalSharesIssued += shares;
        SafeERC20.safeTransferFrom(_asset, msg.sender, address(this), assets);
        share.mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        assets = previewMint(shares);
        totalSharesIssued += shares;
        SafeERC20.safeTransferFrom(_asset, msg.sender, address(this), assets);
        share.mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        uint256 maxAssets = previewRedeem(share.balanceOf(owner));
        if (assets > maxAssets) revert ERC7575ExceededMaxWithdraw(owner, assets, maxAssets);

        shares = previewWithdraw(assets);
        totalSharesIssued -= shares;
        _burnShares(owner, shares);
        SafeERC20.safeTransfer(_asset, receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        uint256 maxShares = share.balanceOf(owner);
        if (shares > maxShares) revert ERC7575ExceededMaxRedeem(owner, shares, maxShares);

        assets = previewRedeem(shares);
        totalSharesIssued -= shares;
        _burnShares(owner, shares);
        SafeERC20.safeTransfer(_asset, receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /// @dev Selectores definidos por ERC-7575 para el vault (0x2f0a18c5) y ERC-165 (0x01ffc9a7)
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x2f0a18c5 || interfaceId == 0x01ffc9a7;
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view returns (uint256) {
        return assets.mulDiv(totalSharesIssued + 1, totalAssets() + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view returns (uint256) {
        return shares.mulDiv(totalAssets() + 1, totalSharesIssued + 1, rounding);
    }

    /// @dev El allowance para quemar en nombre de otro vive en el Share (approve estándar ERC-20)
    function _burnShares(address owner, uint256 shares) internal {
        if (msg.sender != owner) {
            share.transferFrom(owner, address(this), shares);
            share.burn(address(this), shares);
        } else {
            share.burn(owner, shares);
        }
    }
}
