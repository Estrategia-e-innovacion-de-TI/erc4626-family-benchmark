// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Vault ERC-4626 con comisión de entrada, pausa y límite de depósitos
/// @notice
/// Este contrato es un vault para un token ERC20. Funciona así:
/// - tú depositas el token base;
/// - el vault te entrega `shares`, que representan tu parte dentro del vault;
/// - si el vault recibe más activos por fuera, cada `share` vale más;
/// - el dueño puede poner comisión de entrada, pausar el vault y fijar un límite de depósitos.
///
/// La comisión de entrada no se cobra en tokens directamente: se entrega en `shares` al
/// receptor de comisiones. Eso significa que esa dirección también participa en el vault.
///
/// `MockYieldSource` solo se usa en pruebas para simular ganancias: envía activos al vault y
/// así aumenta el valor de cada `share`.
/// @dev La comisión se aplica sobre las `shares` generadas por el depósito o el mint. El vault
/// no cobra comisión de retiro. La función `MockYieldSource` del proyecto se usa para simular
/// rendimiento externo enviando activos directamente al vault, lo que incrementa el valor por share.
contract TokenizedVault is ERC4626, Ownable, Pausable {
    /// @notice Denominador de basis points (100% = 10000 bps)
    uint256 public constant MAX_BPS = 10_000;

    /// @notice Dirección que recibe las comisiones de entrada (acuñadas como `shares`)
    address public feeRecipient;

    /// @notice Comisión de entrada expresada en basis points (bps). Ej.: 50 = 0.5%
    uint256 public entryFeeBps;

    /// @notice Límite (cap) opcional sobre el total de activos que se pueden depositar
    /// Si se fija a `type(uint256).max` significa que no hay límite.
    uint256 public depositCap;
    /// @notice Se emite cuando se actualiza la comisión (bps)
    /// @param entryFeeBps Nueva comisión en basis points
    event EntryFeeUpdated(uint256 entryFeeBps);

    /// @notice Se emite cuando se actualiza la dirección que recibe la comisión
    event FeeRecipientUpdated(address feeRecipient);

    /// @notice Se emite cuando se actualiza el límite de depósitos
    event DepositCapUpdated(uint256 depositCap);

    /// @notice Se emite cuando se acuñan `feeShares` para el receptor de la tarifa
    /// @param payer Cuenta que provocó la comisión (quien depositó o minteó)
    /// @param recipient Dirección que recibe la comisión
    /// @param grossAssets Activos brutos que originaron la comisión
    /// @param feeShares Cantidad de `shares` acuñadas como comisión
    event FeeAccrued(address indexed payer, address indexed recipient, uint256 grossAssets, uint256 feeShares);

    /// @dev Revertir si la comisión en bps es inválida (>= MAX_BPS)
    error InvalidFeeBps();

    /// @dev Revertir si la dirección del receptor de comisión es la dirección cero
    error InvalidFeeRecipient();

    constructor(
        IERC20 asset_,
        address feeRecipient_,
        uint256 entryFeeBps_,
        uint256 depositCap_
    ) ERC20("Vault 4626 Share", "v4626") ERC4626(asset_) Ownable(msg.sender) {
        // Establece el receptor de la comisión (si se pasa address(0) usa el deployer)
        feeRecipient = feeRecipient_ == address(0) ? msg.sender : feeRecipient_;

        // Si se pasa 0 como cap, lo interpretamos como 'sin límite' usando max(uint256)
        depositCap = depositCap_ == 0 ? type(uint256).max : depositCap_;

        // Valida y asigna la comisión de entrada (revertirá si es inválida)
        _setEntryFeeBps(entryFeeBps_);
    }

    /// @notice Actualiza la comisión de entrada (en bps)
    /// @dev Solo puede llamarlo el propietario
    /// @param newEntryFeeBps Comisión en basis points (debe ser < MAX_BPS)
    function setEntryFeeBps(uint256 newEntryFeeBps) external onlyOwner {
        _setEntryFeeBps(newEntryFeeBps);
    }

    /// @notice Cambia la dirección que recibe las comisiones de entrada
    /// @dev No puede establecerse a la dirección cero. Solo el propietario puede llamar.
    /// @param newFeeRecipient Nueva dirección receptora de la comisión
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        // Prevent accidentally setting recipient to zero address
        if (newFeeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }

        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    /// @notice Establece un límite máximo de activos totales para depósitos
    /// @dev Pasa 0 para quitar el límite (se pone `type(uint256).max`). Solo propietario.
    /// @param newDepositCap Límite máximo de activos permitidos en el vault
    function setDepositCap(uint256 newDepositCap) external onlyOwner {
        // Treat 0 as 'no cap' for convenience
        depositCap = newDepositCap == 0 ? type(uint256).max : newDepositCap;
        emit DepositCapUpdated(depositCap);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        // Calcula las `grossShares` que ERC4626 acuñaría por `assets`
        uint256 grossShares = super.previewDeposit(assets);

        // Devuelve las `shares` netas tras aplicar la comisión de entrada
        return _applyEntryFee(grossShares);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        // Dado un número neto de `shares` que queremos que reciba el usuario,
        // calcula las `grossShares` necesarias antes de restar la comisión.
        uint256 grossShares = _grossSharesForNetShares(shares);

        // Pregunta a ERC4626 cuántos activos se necesitan para acuñar `grossShares`
        return super.previewMint(grossShares);
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) {
            return 0;
        }

        if (depositCap == type(uint256).max) {
            return type(uint256).max;
        }

        uint256 totalAssetsHeld = totalAssets();
        if (totalAssetsHeld >= depositCap) {
            return 0;
        }

        return depositCap - totalAssetsHeld;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (paused()) {
            return 0;
        }

        uint256 maxAssets = maxDeposit(receiver);
        if (maxAssets == type(uint256).max) {
            return type(uint256).max;
        }

        return previewDeposit(maxAssets);
    }

    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }
        // Calcula las `grossShares` según ERC4626 y sepáralas en comisión + neto
        uint256 grossShares = super.previewDeposit(assets);
        uint256 feeShares = _entryFeeShares(grossShares);
        uint256 netShares = grossShares - feeShares;

        // Ejecuta el depósito (ERC4626) acreditando `netShares` al receptor
        _deposit(_msgSender(), receiver, assets, netShares);

        // Si aplica, acuña las `feeShares` al `feeRecipient`
        if (feeShares > 0) {
            _mint(feeRecipient, feeShares);
            emit FeeAccrued(_msgSender(), feeRecipient, assets, feeShares);
        }

        return netShares;
    }

    function mint(uint256 shares, address receiver) public override whenNotPaused returns (uint256) {
        uint256 maxShares = maxMint(receiver);
        if (shares > maxShares) {
            revert ERC4626ExceededMaxMint(receiver, shares, maxShares);
        }
        // Convierte las `shares` netas solicitadas en las `grossShares` necesarias
        uint256 grossShares = _grossSharesForNetShares(shares);

        // Calcula cuántos activos hacen falta para acuñar las `grossShares`
        uint256 assets = super.previewMint(grossShares);

        // La comisión es la diferencia entre gross y net
        uint256 feeShares = grossShares - shares;

        // Realiza el depósito y acredita `shares` al receptor
        _deposit(_msgSender(), receiver, assets, shares);

        // Acuña las `feeShares` al receptor de comisión si aplica
        if (feeShares > 0) {
            _mint(feeRecipient, feeShares);
            emit FeeAccrued(_msgSender(), feeRecipient, assets, feeShares);
        }

        return assets;
    }

    function _setEntryFeeBps(uint256 newEntryFeeBps) internal {
        if (newEntryFeeBps >= MAX_BPS) {
            revert InvalidFeeBps();
        }
        // Asegura que la comisión sea estrictamente menor que 100% (MAX_BPS)
        entryFeeBps = newEntryFeeBps;
        emit EntryFeeUpdated(newEntryFeeBps);
    }

    function _entryFeeShares(uint256 grossShares) internal view returns (uint256) {
        // Calcula las `feeShares` = floor(grossShares * entryFeeBps / MAX_BPS)
        return Math.mulDiv(grossShares, entryFeeBps, MAX_BPS, Math.Rounding.Floor);
    }

    function _applyEntryFee(uint256 grossShares) internal view returns (uint256) {
        // Devuelve las `shares` netas tras restar la parte correspondiente a la comisión
        return grossShares - _entryFeeShares(grossShares);
    }

    function _grossSharesForNetShares(uint256 netShares) internal view returns (uint256) {
        if (entryFeeBps == 0) {
            return netShares;
        }
        // Dado `netShares`, calcula el mínimo `grossShares` que cumple:
        // netShares = grossShares - floor(grossShares * entryFeeBps / MAX_BPS)
        // Es decir, grossShares = ceil(netShares * MAX_BPS / (MAX_BPS - entryFeeBps))
        return Math.mulDiv(netShares, MAX_BPS, MAX_BPS - entryFeeBps, Math.Rounding.Ceil);
    }
}