// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MarketRiskOracle
/// @notice Publishes auditable market-session, price, freshness, and liquidity data.
/// @dev Prices are USD per whole collateral token, scaled by 1e18.
contract MarketRiskOracle {
    enum MarketState {
        Open,
        Closed,
        Unavailable
    }

    struct Risk {
        uint128 price;
        uint16 freshnessBps;
        uint16 liquidityBps;
        uint64 asOf;
        MarketState state;
        bytes32 inputsHash;
    }

    address public owner;
    address public pendingOwner;
    uint64 public maxAge;
    mapping(address => bool) public isPublisher;
    mapping(address => Risk) public risks;

    event RiskPublished(
        address indexed asset,
        uint128 price,
        uint16 freshnessBps,
        uint16 liquidityBps,
        uint64 asOf,
        MarketState state,
        bytes32 inputsHash
    );
    event PublisherSet(address indexed publisher, bool allowed);
    event MaxAgeSet(uint64 maxAge);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotPublisher();
    error ZeroAddress();
    error InvalidRisk();
    error BadTimestamp();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPublisher() {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        _;
    }

    constructor(address owner_, uint64 maxAge_) {
        if (owner_ == address(0) || maxAge_ == 0) revert ZeroAddress();
        owner = owner_;
        maxAge = maxAge_;
        emit OwnershipTransferred(address(0), owner_);
        emit MaxAgeSet(maxAge_);
    }

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        if (publisher == address(0)) revert ZeroAddress();
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    function setMaxAge(uint64 maxAge_) external onlyOwner {
        if (maxAge_ == 0) revert InvalidRisk();
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    function publish(address asset, Risk calldata risk) external onlyPublisher {
        _publish(asset, risk);
    }

    function publishBatch(address[] calldata assets, Risk[] calldata updates) external onlyPublisher {
        if (assets.length != updates.length) revert LengthMismatch();
        for (uint256 i; i < assets.length; ++i) _publish(assets[i], updates[i]);
    }

    function _publish(address asset, Risk calldata risk) internal {
        if (asset == address(0)) revert ZeroAddress();
        if (risk.asOf > block.timestamp || risk.asOf <= risks[asset].asOf) revert BadTimestamp();
        if (risk.state == MarketState.Unavailable) {
            if (risk.price != 0 || risk.freshnessBps != 0 || risk.liquidityBps != 0) revert InvalidRisk();
        } else if (risk.price == 0 || risk.freshnessBps > 10_000 || risk.liquidityBps > 20_000) {
            revert InvalidRisk();
        }
        risks[asset] = risk;
        emit RiskPublished(
            asset,
            risk.price,
            risk.freshnessBps,
            risk.liquidityBps,
            risk.asOf,
            risk.state,
            risk.inputsHash
        );
    }

    function currentRisk(address asset) external view returns (bool available, Risk memory risk) {
        risk = risks[asset];
        available = risk.asOf != 0 && risk.state != MarketState.Unavailable
            && block.timestamp <= uint256(risk.asOf) + maxAge;
    }

    function verifyInputs(address asset, bytes calldata rawInputs) external view returns (bool) {
        return keccak256(rawInputs) == risks[asset].inputsHash;
    }
}
