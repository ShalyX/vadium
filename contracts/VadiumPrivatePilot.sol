// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VadiumCreditPool} from "./VadiumCreditPool.sol";
import {MarketRiskOracle} from "./MarketRiskOracle.sol";

/// @notice Synthetic price for a private transaction rehearsal. NOT a market feed.
contract PrivatePilotPrice {
    address public immutable collateral;
    uint128 public immutable testPrice;
    uint64 public immutable createdAt;
    uint64 public immutable expiresAt;

    constructor(address collateral_, uint128 price_) {
        require(collateral_ != address(0) && price_ > 0, "Invalid test price");
        collateral = collateral_;
        testPrice = price_;
        createdAt = uint64(block.timestamp);
        expiresAt = uint64(block.timestamp + 7 days);
    }

    function currentRisk(address asset) external view returns (bool available, MarketRiskOracle.Risk memory risk) {
        available = asset == collateral && block.timestamp <= expiresAt;
        risk = MarketRiskOracle.Risk(testPrice, 10000, 10000, createdAt,
            MarketRiskOracle.MarketState.Open, keccak256("OPERATOR_SET_SYNTHETIC_PILOT_PRICE_NOT_MARKET_DATA"));
    }
}

/// @notice One immutable participant, self-funded, tiny mainnet execution pilot.
/// @dev Price and risk scores are test inputs; no public lending is supported.
contract VadiumPrivatePilot is VadiumCreditPool {
    address public immutable participant;
    uint256 public immutable supplyCap;
    uint256 public suppliedLifetime;
    uint64 public immutable expiresAt;
    error PrivateParticipantOnly();
    error PilotCapExceeded();
    error PilotExpired();

    constructor(address stable_, address wrapper_, address price_, address underlying_, address participant_)
        VadiumCreditPool(stable_, wrapper_, price_, underlying_, 2500, 5000, 10000, 10000, 10000,
            0, 100, 10000)
    {
        if (participant_ == address(0) || stableDecimals != 6 || underlying_ == address(0)) revert InvalidConfiguration();
        participant = participant_;
        supplyCap = 20000; // 0.02 USDG lifetime supply; cannot be enlarged by owner.
        expiresAt = uint64(block.timestamp + 7 days);
    }

    function _beforeAction(bytes4 action, uint256 amount) internal override {
        if (msg.sender != participant) revert PrivateParticipantOnly();
        if (action == this.supply.selector || action == this.borrow.selector) {
            if (block.timestamp > expiresAt) revert PilotExpired();
        }
        if (action == this.supply.selector) {
            suppliedLifetime += amount;
            if (suppliedLifetime > supplyCap) revert PilotCapExceeded();
        }
        // Repay, top-up and exits remain available after expiry and during pause.
        // Debt ceiling is inherited and immutable: 0.01 USDG, interest may accrue above it.
    }
}
