// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @dev Test-only wrapper with a fixed exchange rate. It is not a production vault.
contract MockWrapper is MockERC20 {
    address public immutable asset;
    uint256 public immutable assetsPerShare;

    constructor(address asset_, uint256 assetsPerShare_)
        MockERC20("Wrapped test equity", "wAAPLx", 18)
    {
        require(asset_ != address(0) && assetsPerShare_ != 0);
        asset = asset_;
        assetsPerShare = assetsPerShare_;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares * assetsPerShare / 1e18;
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        return assets * 1e18 / assetsPerShare;
    }
}
