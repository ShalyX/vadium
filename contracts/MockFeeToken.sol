// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @dev Test-only fee token used to prove the pool rejects short transfers.
contract MockFeeToken is MockERC20 {
    constructor() MockERC20("Fee token", "FEE", 18) {}

    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
        emit Transfer(from, address(0), fee);
    }
}
