// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for Chainlink Data Streams' onchain VerifierProxy.
interface IStreamsVerifier {
    function verify(bytes calldata payload, bytes calldata parameterPayload) external payable returns (bytes memory);
}

/// @title VerifiedMarketRiskOracle
/// @notice Adapts a verified Chainlink tokenized-asset report to Vadium's risk interface.
/// @dev Price and market status come from the signed report. The publisher supplies a separately
///      auditable liquidity score; compromise of that publisher can still affect credit policy.
contract VerifiedMarketRiskOracle {
    enum MarketState { Open, Closed, Unavailable }

    struct Risk {
        uint128 price;
        uint16 freshnessBps;
        uint16 liquidityBps;
        uint64 asOf;
        MarketState state;
        bytes32 inputsHash;
    }

    // Chainlink tokenized-asset Data Streams report schema v10.
    struct ReportV10 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        uint64 lastUpdateTimestamp; // nanoseconds
        int192 price; // USD, 18 decimals for the configured xStock feed
        uint32 marketStatus; // 0 unknown, 1 closed, 2 open
        int192 currentMultiplier;
        int192 newMultiplier;
        uint32 activationDateTime;
        int192 tokenizedPrice;
    }

    IStreamsVerifier public immutable verifier;
    bytes32 public immutable feedId;
    address public immutable asset;
    uint64 public immutable maxReportAge;
    uint64 public immutable maxPriceAge;
    uint64 public immutable freshnessGrace;

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public isPublisher;
    Risk public latestRisk;
    uint64 public priceUpdatedAt;
    uint32 public reportExpiresAt;

    event RiskPublished(address indexed asset, uint128 price, uint16 freshnessBps, uint16 liquidityBps,
        uint64 asOf, MarketState state, bytes32 inputsHash);
    event PublisherSet(address indexed publisher, bool allowed);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error NotPublisher();
    error InvalidConfiguration();
    error InvalidReport();
    error BadTimestamp();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address verifier_, bytes32 feedId_, address asset_, uint64 maxReportAge_,
        uint64 maxPriceAge_, uint64 freshnessGrace_) {
        if (verifier_ == address(0) || feedId_ == bytes32(0) || asset_ == address(0)
            || maxReportAge_ == 0 || maxPriceAge_ <= freshnessGrace_ || freshnessGrace_ == 0) {
            revert InvalidConfiguration();
        }
        verifier = IStreamsVerifier(verifier_);
        feedId = feedId_;
        asset = asset_;
        maxReportAge = maxReportAge_;
        maxPriceAge = maxPriceAge_;
        freshnessGrace = freshnessGrace_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        if (publisher == address(0)) revert InvalidConfiguration();
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert InvalidConfiguration();
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

    function publishVerified(bytes calldata signedPayload, uint16 liquidityBps, bytes32 inputsHash) external {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        if (liquidityBps > 20_000) revert InvalidReport();
        ReportV10 memory report = abi.decode(verifier.verify(signedPayload, bytes("")), (ReportV10));
        if (report.feedId != feedId || report.price <= 0 || uint256(uint192(report.price)) > type(uint128).max
            || report.currentMultiplier <= 0 || report.tokenizedPrice <= 0) revert InvalidReport();
        if (report.observationsTimestamp <= latestRisk.asOf || report.validFromTimestamp > block.timestamp
            || report.observationsTimestamp > block.timestamp || report.expiresAt < block.timestamp
            || report.expiresAt < report.observationsTimestamp) revert BadTimestamp();
        uint256 priceTime = uint256(report.lastUpdateTimestamp) / 1e9;
        if (priceTime == 0 || priceTime > report.observationsTimestamp) revert BadTimestamp();

        MarketState state = report.marketStatus == 2 ? MarketState.Open
            : report.marketStatus == 1 ? MarketState.Closed : MarketState.Unavailable;
        // A pending corporate action needs explicit human review before new borrowing resumes.
        if (report.newMultiplier != 0 || report.activationDateTime != 0) state = MarketState.Unavailable;
        uint16 freshness = _freshness(block.timestamp - priceTime);
        if (freshness == 0) state = MarketState.Unavailable;
        uint128 price = state == MarketState.Unavailable ? 0 : uint128(uint192(report.price));
        latestRisk = Risk(price, state == MarketState.Unavailable ? 0 : freshness,
            state == MarketState.Unavailable ? 0 : liquidityBps, report.observationsTimestamp, state, inputsHash);
        priceUpdatedAt = uint64(priceTime);
        reportExpiresAt = report.expiresAt;
        emit RiskPublished(asset, latestRisk.price, latestRisk.freshnessBps, latestRisk.liquidityBps,
            latestRisk.asOf, latestRisk.state, inputsHash);
    }

    function currentRisk(address requestedAsset) external view returns (bool available, Risk memory risk) {
        risk = latestRisk;
        if (requestedAsset != asset) return (false, Risk(0, 0, 0, 0, MarketState.Unavailable, bytes32(0)));
        uint256 age = priceUpdatedAt == 0 || priceUpdatedAt > block.timestamp
            ? type(uint256).max : block.timestamp - priceUpdatedAt;
        risk.freshnessBps = age == type(uint256).max ? 0 : _freshness(age);
        available = risk.asOf != 0 && risk.state != MarketState.Unavailable && risk.freshnessBps != 0
            && block.timestamp <= uint256(risk.asOf) + maxReportAge && block.timestamp <= reportExpiresAt;
    }

    function _freshness(uint256 age) private view returns (uint16) {
        if (age <= freshnessGrace) return 10_000;
        if (age >= maxPriceAge) return 0;
        return uint16((10_000 * (maxPriceAge - age)) / (maxPriceAge - freshnessGrace));
    }
}
