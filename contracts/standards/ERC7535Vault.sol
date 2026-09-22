// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice ERC-7535 (Final, Requires: ERC-20, ERC-4626, ERC-7528): vault ERC-4626 con ETH nativo como asset
/// @dev No hereda `ERC4626` de OZ a propósito: el EIP exige que `deposit`/`mint` sean `payable`, y Solidity
/// no permite sobre-escribir una función `nonpayable` heredada (como `IERC4626.deposit`) para volverla `payable`.
/// Por eso este contrato reimplementa manualmente la contabilidad de ERC-4626 sobre ETH nativo.
/// @dev Riesgo: transferencias forzadas de ETH (p. ej. vía `SELFDESTRUCT` de otro contrato) inflan
/// `totalAssets()` sin pasar por `deposit`, y el uso de `call` en `_sendEth` abre la puerta a reentrancy
/// si el receptor es un contrato malicioso (mitigado aquí por el orden burn-antes-de-enviar).
contract ERC7535Vault is ERC20 {
    using Math for uint256;

    /// @dev Dirección centinela para "ETH nativo" definida por ERC-7528
    address public constant ETH_SENTINEL = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    error ERC7535InsufficientPayment(uint256 sent, uint256 required);
    error ERC7535TransferFailed();
    error ERC7535ExceededMaxWithdraw(address owner, uint256 assets, uint256 max);
    error ERC7535ExceededMaxRedeem(address owner, uint256 shares, uint256 max);

    constructor() ERC20("ERC7535 Native ETH Vault", "e7535V") {}

    function asset() external pure returns (address) {
        return ETH_SENTINEL;
    }

    function totalAssets() public view returns (uint256) {
        return address(this).balance;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets(), Math.Rounding.Floor);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, totalAssets(), Math.Rounding.Floor);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets(), Math.Rounding.Floor);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, totalAssets(), Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets(), Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, totalAssets(), Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        return previewRedeem(balanceOf(owner));
    }

    function maxRedeem(address owner) public view returns (uint256) {
        return balanceOf(owner);
    }

    /// @notice Deposita ETH nativo; `assets` se ignora en favor de `msg.value` (permitido por el EIP)
    function deposit(uint256, address receiver) external payable returns (uint256 shares) {
        // msg.value ya está sumado a address(this).balance antes de ejecutar este código.
        uint256 assetsBefore = totalAssets() - msg.value;
        shares = _convertToShares(msg.value, assetsBefore, Math.Rounding.Floor);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, msg.value, shares);
    }

    /// @notice Mintea exactamente `shares`; reembolsa el ETH sobrante si `msg.value` excede lo requerido
    function mint(uint256 shares, address receiver) external payable returns (uint256 assets) {
        uint256 assetsBefore = totalAssets() - msg.value;
        assets = _convertToAssets(shares, assetsBefore, Math.Rounding.Ceil);
        if (msg.value < assets) revert ERC7535InsufficientPayment(msg.value, assets);

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);

        uint256 refund = msg.value - assets;
        if (refund > 0) _sendEth(msg.sender, refund);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) revert ERC7535ExceededMaxWithdraw(owner, assets, maxAssets);

        shares = previewWithdraw(assets);
        _withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC7535ExceededMaxRedeem(owner, shares, maxShares);

        assets = previewRedeem(shares);
        _withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        _sendEth(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert ERC7535TransferFailed();
    }

    function _convertToShares(
        uint256 assets,
        uint256 assetsBase,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        return assets.mulDiv(totalSupply() + 1, assetsBase + 1, rounding);
    }

    function _convertToAssets(
        uint256 shares,
        uint256 assetsBase,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        return shares.mulDiv(assetsBase + 1, totalSupply() + 1, rounding);
    }

    /// @dev Permite recibir donaciones/transferencias directas de ETH (ver riesgo documentado arriba)
    receive() external payable {}
}
