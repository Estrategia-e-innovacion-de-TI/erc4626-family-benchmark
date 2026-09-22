// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice ERC-7575 (Final, Requires: ERC-4626): token de shares desacoplado de cualquier vault concreto
/// @dev Permite que varios `ERC7575Vault` (uno por asset) compartan el mismo share, resolviendo el caso
/// de vaults multi-asset o LP tokens que no encajan bien siendo ellos mismos un ERC-20 (ver `ERC7575Vault`).
/// @dev Riesgo: este contrato confía ciegamente en cualquier vault autorizado vía `updateVault`; un vault
/// malicioso o con bugs registrado aquí puede mintear/quemar shares arbitrariamente y diluir a todos los holders.
contract ERC7575Share is ERC20, Ownable {
    /// @notice Vault registrado como entry point para un asset dado
    mapping(address asset => address) public vault;
    mapping(address => bool) private _isVault;

    event VaultUpdate(address indexed asset, address vault);

    error NotAuthorizedVault();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {}

    modifier onlyVault() {
        if (!_isVault[msg.sender]) revert NotAuthorizedVault();
        _;
    }

    /// @notice Registra `vault_` como el único entry point autorizado para `asset`
    function updateVault(address asset, address vault_) external onlyOwner {
        vault[asset] = vault_;
        _isVault[vault_] = true;
        emit VaultUpdate(asset, vault_);
    }

    /// @notice Acuña shares; solo puede llamarlo un vault registrado
    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    /// @notice Quema shares; solo puede llamarlo un vault registrado
    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    /// @dev Selectores definidos por ERC-7575 para el share (0xf815c03d) y ERC-165 (0x01ffc9a7)
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0xf815c03d || interfaceId == 0x01ffc9a7;
    }
}
