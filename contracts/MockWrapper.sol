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

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return assets * 1e18 / assetsPerShare;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return shares * assetsPerShare / 1e18;
    }

    function maxDeposit(address) external pure returns (uint256) { return type(uint256).max; }

    function maxRedeem(address owner) external view returns (uint256) { return balanceOf[owner]; }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = previewDeposit(assets);
        require(shares != 0 && MockERC20(asset).transferFrom(msg.sender, address(this), assets));
        balanceOf[receiver] += shares;
        totalSupply += shares;
        emit Transfer(address(0), receiver, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(msg.sender == owner && shares <= balanceOf[owner]);
        assets = previewRedeem(shares);
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        emit Transfer(owner, address(0), shares);
        require(MockERC20(asset).transfer(receiver, assets));
    }
}
