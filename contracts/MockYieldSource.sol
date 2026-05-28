// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockYieldSource is Ownable {
    IERC20 public immutable asset;

    constructor(IERC20 asset_) Ownable(msg.sender) {
        asset = asset_;
    }

    function fundVault(address vault, uint256 amount) external onlyOwner {
        require(asset.transfer(vault, amount), "YIELD_TRANSFER_FAILED");
    }
}