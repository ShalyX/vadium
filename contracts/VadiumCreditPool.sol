// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketRiskOracle} from "./MarketRiskOracle.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}

interface IERC4626Collateral {
    function asset() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
}

/// @title VadiumCreditPool
/// @notice An isolated, interest-bearing USDG credit line for one wrapped tokenized equity.
/// @dev Session and confidence data only constrain risk-increasing actions. The
///      liquidation threshold is independent, so a market close cannot itself liquidate users.
contract VadiumCreditPool {
    uint256 private constant BPS = 10_000;
    uint256 private constant RAY = 1e27;
    uint256 private constant YEAR = 365 days;

    IERC20 public immutable stable;
    IERC20 public immutable collateral;
    address public immutable underlyingCollateral;
    MarketRiskOracle public immutable oracle;
    uint8 public immutable stableDecimals;
    uint8 public immutable collateralDecimals;
    uint8 public immutable underlyingDecimals;

    uint16 public immutable baseBorrowLtvBps;
    uint16 public immutable liquidationLtvBps;
    uint16 public immutable closedSessionFactorBps;
    uint16 public immutable minFreshnessBps;
    uint16 public immutable minLiquidityBps;
    uint16 public immutable liquidationBonusBps;
    uint16 public immutable annualRateBps;
    uint256 public immutable debtCeiling;

    address public owner;
    address public pendingOwner;
    bool public borrowPaused;
    bool public supplyPaused;

    uint256 public totalLiquidityShares;
    uint256 public totalDebtShares;
    uint256 public borrowIndexRay;
    uint256 public lastAccruedAt;
    mapping(address => uint256) public liquidityShares;
    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtSharesOf;

    uint256 private unlocked = 1;

    event LiquiditySupplied(address indexed lender, uint256 assets, uint256 shares);
    event LiquidityWithdrawn(address indexed lender, uint256 assets, uint256 shares);
    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event InterestAccrued(uint256 borrowIndexRay, uint256 totalDebt);
    event BadDebtWrittenOff(address indexed borrower, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 repaid, uint256 seized);
    event RiskPauseSet(bool borrowPaused, bool supplyPaused);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error InvalidConfiguration();
    error ZeroAmount();
    error InsufficientCash();
    error InsufficientShares();
    error RiskUnavailable();
    error RiskLimit();
    error DebtCeilingExceeded();
    error HealthyPosition();
    error FullCloseRequired();
    error TransferFailed();
    error UnexpectedTransferAmount();
    error Reentrancy();
    error Paused();
    error NotOwner();
    error NotPendingOwner();

    modifier nonReentrant() {
        if (unlocked != 1) revert Reentrancy();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    /// @dev Extension point for permanently restricted private pilots.
    function _beforeAction(bytes4, uint256) internal virtual {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address stable_,
        address collateral_,
        address oracle_,
        address underlyingCollateral_,
        uint16 baseBorrowLtvBps_,
        uint16 liquidationLtvBps_,
        uint16 closedSessionFactorBps_,
        uint16 minFreshnessBps_,
        uint16 minLiquidityBps_,
        uint16 liquidationBonusBps_,
        uint16 annualRateBps_,
        uint256 debtCeiling_
    ) {
        if (
            stable_ == address(0) || collateral_ == address(0) || oracle_ == address(0)
                || stable_ == collateral_
                || baseBorrowLtvBps_ == 0 || baseBorrowLtvBps_ >= liquidationLtvBps_
                || liquidationLtvBps_ > BPS || closedSessionFactorBps_ > BPS
                || minFreshnessBps_ > BPS || minLiquidityBps_ > 20_000
                || liquidationBonusBps_ > 2_000 || annualRateBps_ == 0
                || annualRateBps_ > 5_000 || debtCeiling_ == 0
        ) revert InvalidConfiguration();

        stable = IERC20(stable_);
        collateral = IERC20(collateral_);
        oracle = MarketRiskOracle(oracle_);
        stableDecimals = IERC20Metadata(stable_).decimals();
        collateralDecimals = IERC20Metadata(collateral_).decimals();
        underlyingCollateral = underlyingCollateral_;
        if (underlyingCollateral_ != address(0)) {
            if (underlyingCollateral_ == collateral_ || IERC4626Collateral(collateral_).asset() != underlyingCollateral_) {
                revert InvalidConfiguration();
            }
            underlyingDecimals = IERC20Metadata(underlyingCollateral_).decimals();
            if (IERC4626Collateral(collateral_).convertToAssets(10 ** collateralDecimals) == 0) {
                revert InvalidConfiguration();
            }
        } else {
            underlyingDecimals = collateralDecimals;
        }
        if (stableDecimals > 18 || collateralDecimals > 18 || underlyingDecimals > 18) revert InvalidConfiguration();
        baseBorrowLtvBps = baseBorrowLtvBps_;
        liquidationLtvBps = liquidationLtvBps_;
        closedSessionFactorBps = closedSessionFactorBps_;
        minFreshnessBps = minFreshnessBps_;
        minLiquidityBps = minLiquidityBps_;
        liquidationBonusBps = liquidationBonusBps_;
        annualRateBps = annualRateBps_;
        debtCeiling = debtCeiling_;
        borrowIndexRay = RAY;
        lastAccruedAt = block.timestamp;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function setRiskPause(bool borrowPaused_, bool supplyPaused_) external onlyOwner {
        borrowPaused = borrowPaused_;
        supplyPaused = supplyPaused_;
        emit RiskPauseSet(borrowPaused_, supplyPaused_);
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

    function currentBorrowIndexRay() public view returns (uint256) {
        if (totalDebtShares == 0 || block.timestamp == lastAccruedAt) return borrowIndexRay;
        uint256 elapsed = block.timestamp - lastAccruedAt;
        uint256 ratePerSecondRay = RAY + RAY * annualRateBps / BPS / YEAR;
        return _mulRay(borrowIndexRay, _rayPow(ratePerSecondRay, elapsed));
    }

    function _mulRay(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b + RAY / 2) / RAY;
    }

    /// @dev Nominal annual rate compounded each second. Exponentiation by squaring
    ///      makes the result independent of how often unrelated transactions accrue.
    function _rayPow(uint256 base, uint256 exponent) internal pure returns (uint256 result) {
        result = RAY;
        while (exponent != 0) {
            if (exponent & 1 != 0) result = _mulRay(result, base);
            exponent >>= 1;
            if (exponent != 0) base = _mulRay(base, base);
        }
    }

    function debtOf(address borrower) public view returns (uint256) {
        return _debtFromShares(debtSharesOf[borrower], currentBorrowIndexRay());
    }

    function totalDebt() public view returns (uint256) {
        return _debtFromShares(totalDebtShares, currentBorrowIndexRay());
    }

    function totalAssets() public view returns (uint256) {
        return stable.balanceOf(address(this)) + totalDebt();
    }

    function _accrueInterest() internal {
        if (block.timestamp == lastAccruedAt) return;
        borrowIndexRay = currentBorrowIndexRay();
        lastAccruedAt = block.timestamp;
        if (totalDebtShares != 0) emit InterestAccrued(borrowIndexRay, _debtFromShares(totalDebtShares, borrowIndexRay));
    }

    function _debtFromShares(uint256 shares, uint256 index) internal pure returns (uint256) {
        if (shares == 0) return 0;
        return (shares * index + RAY - 1) / RAY;
    }

    function supply(uint256 assets) external nonReentrant returns (uint256 shares) {
        _beforeAction(msg.sig, assets);
        if (supplyPaused) revert Paused();
        if (assets == 0) revert ZeroAmount();
        _accrueInterest();
        uint256 assetsBefore = totalAssets();
        shares = totalLiquidityShares == 0 ? assets : assets * totalLiquidityShares / assetsBefore;
        if (shares == 0) revert ZeroAmount();
        totalLiquidityShares += shares;
        liquidityShares[msg.sender] += shares;
        _safeTransferFrom(stable, msg.sender, address(this), assets);
        emit LiquiditySupplied(msg.sender, assets, shares);
    }

    function withdrawLiquidity(uint256 shares) external nonReentrant returns (uint256 assets) {
        _beforeAction(msg.sig, shares);
        if (shares == 0) revert ZeroAmount();
        if (shares > liquidityShares[msg.sender]) revert InsufficientShares();
        _accrueInterest();
        assets = shares * totalAssets() / totalLiquidityShares;
        if (assets > stable.balanceOf(address(this))) revert InsufficientCash();
        liquidityShares[msg.sender] -= shares;
        totalLiquidityShares -= shares;
        _safeTransfer(stable, msg.sender, assets);
        emit LiquidityWithdrawn(msg.sender, assets, shares);
    }

    function depositCollateral(uint256 amount) external nonReentrant {
        _beforeAction(msg.sig, amount);
        if (amount == 0) revert ZeroAmount();
        collateralOf[msg.sender] += amount;
        _safeTransferFrom(collateral, msg.sender, address(this), amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        _beforeAction(msg.sig, amount);
        if (amount == 0) revert ZeroAmount();
        collateralOf[msg.sender] -= amount;
        if (debtOf(msg.sender) != 0) {
            uint256 capacity = borrowCapacity(msg.sender);
            if (capacity == 0) revert RiskUnavailable();
            if (debtOf(msg.sender) > capacity) revert RiskLimit();
        }
        _safeTransfer(collateral, msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant {
        _beforeAction(msg.sig, amount);
        if (borrowPaused) revert Paused();
        if (amount == 0) revert ZeroAmount();
        _accrueInterest();
        uint256 newShares = (amount * RAY + borrowIndexRay - 1) / borrowIndexRay;
        uint256 newDebt = _debtFromShares(newShares, borrowIndexRay);
        uint256 capacity = borrowCapacity(msg.sender);
        if (capacity == 0) revert RiskUnavailable();
        if (debtOf(msg.sender) + newDebt > capacity) revert RiskLimit();
        if (totalDebt() + newDebt > debtCeiling) revert DebtCeilingExceeded();
        if (amount > stable.balanceOf(address(this))) revert InsufficientCash();
        debtSharesOf[msg.sender] += newShares;
        totalDebtShares += newShares;
        _safeTransfer(stable, msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant returns (uint256 paid) {
        _beforeAction(msg.sig, amount);
        if (amount == 0) revert ZeroAmount();
        _accrueInterest();
        uint256 shares = debtSharesOf[msg.sender];
        if (shares == 0) revert ZeroAmount();
        uint256 borrowerDebt = _debtFromShares(shares, borrowIndexRay);
        uint256 burnShares = amount >= borrowerDebt ? shares : amount * RAY / borrowIndexRay;
        if (burnShares == 0) revert ZeroAmount();
        paid = _debtFromShares(burnShares, borrowIndexRay);
        debtSharesOf[msg.sender] -= burnShares;
        totalDebtShares -= burnShares;
        _safeTransferFrom(stable, msg.sender, address(this), paid);
        emit Repaid(msg.sender, paid);
    }

    function creditMultiplierBps() public view returns (uint256) {
        (bool available, MarketRiskOracle.Risk memory risk) = oracle.currentRisk(address(collateral));
        if (
            !available || risk.freshnessBps < minFreshnessBps || risk.liquidityBps < minLiquidityBps
                || risk.state == MarketRiskOracle.MarketState.Unavailable
        ) return 0;
        uint256 score = risk.freshnessBps < risk.liquidityBps ? risk.freshnessBps : risk.liquidityBps;
        if (score > BPS) score = BPS;
        if (risk.state == MarketRiskOracle.MarketState.Closed) {
            score = score * closedSessionFactorBps / BPS;
        }
        return score;
    }

    function borrowCapacity(address borrower) public view returns (uint256) {
        uint256 multiplier = creditMultiplierBps();
        if (multiplier == 0) return 0;
        (, MarketRiskOracle.Risk memory risk) = oracle.currentRisk(address(collateral));
        return _collateralValue(collateralOf[borrower], risk.price) * baseBorrowLtvBps * multiplier / BPS / BPS;
    }

    function isLiquidatable(address borrower) public view returns (bool) {
        (bool available, MarketRiskOracle.Risk memory risk) = oracle.currentRisk(address(collateral));
        if (!available || debtOf(borrower) == 0) return false;
        uint256 threshold = _collateralValue(collateralOf[borrower], risk.price) * liquidationLtvBps / BPS;
        return debtOf(borrower) > threshold;
    }

    function liquidate(address borrower, uint256 requestedRepay) external nonReentrant returns (uint256 repaid, uint256 seized) {
        _beforeAction(msg.sig, requestedRepay);
        if (requestedRepay == 0) revert ZeroAmount();
        _accrueInterest();
        (bool available, MarketRiskOracle.Risk memory risk) = oracle.currentRisk(address(collateral));
        if (!available) revert RiskUnavailable();
        if (!isLiquidatable(borrower)) revert HealthyPosition();

        uint256 borrowerShares = debtSharesOf[borrower];
        uint256 borrowerDebt = _debtFromShares(borrowerShares, borrowIndexRay);
        // At stablecoin precision, this collateral cannot fund even one unit of
        // repayment. Foreclose it for one unit so the residual debt can be
        // written off without leaving collateral that the borrower can reclaim.
        if (_collateralValue(collateralOf[borrower], risk.price) == 0) {
            if (requestedRepay < borrowerDebt) revert FullCloseRequired();
            repaid = 1;
            seized = collateralOf[borrower];
            collateralOf[borrower] = 0;
            debtSharesOf[borrower] = 0;
            totalDebtShares -= borrowerShares;
            _safeTransferFrom(stable, msg.sender, address(this), repaid);
            _safeTransfer(collateral, msg.sender, seized);
            emit Liquidated(borrower, msg.sender, repaid, seized);
            emit BadDebtWrittenOff(borrower, borrowerDebt - repaid);
            return (repaid, seized);
        }
        uint256 burnShares = requestedRepay >= borrowerDebt
            ? borrowerShares : requestedRepay * RAY / borrowIndexRay;
        if (burnShares == 0) revert ZeroAmount();
        repaid = _debtFromShares(burnShares, borrowIndexRay);
        uint256 seizeValue = repaid * (BPS + liquidationBonusBps) / BPS;
        seized = _stableValueToCollateral(seizeValue, risk.price);
        if (seized > collateralOf[borrower]) {
            uint256 repayLimit = _collateralValue(collateralOf[borrower], risk.price) * BPS
                / (BPS + liquidationBonusBps);
            burnShares = repayLimit >= borrowerDebt ? borrowerShares : repayLimit * RAY / borrowIndexRay;
            if (burnShares == 0) revert ZeroAmount();
            repaid = _debtFromShares(burnShares, borrowIndexRay);
            // The repayment is rounded down; transfer the full collateral at exhaustion.
            seized = collateralOf[borrower];
        }
        if (repaid == 0 || seized == 0) revert ZeroAmount();

        debtSharesOf[borrower] -= burnShares;
        totalDebtShares -= burnShares;
        collateralOf[borrower] -= seized;
        _safeTransferFrom(stable, msg.sender, address(this), repaid);
        _safeTransfer(collateral, msg.sender, seized);
        emit Liquidated(borrower, msg.sender, repaid, seized);
        if (collateralOf[borrower] == 0) _writeOffBadDebt(borrower);
    }

    function writeOffBadDebt(address borrower) external nonReentrant returns (uint256 loss) {
        _beforeAction(msg.sig, 0);
        if (collateralOf[borrower] != 0) revert HealthyPosition();
        _accrueInterest();
        loss = _writeOffBadDebt(borrower);
    }

    function _writeOffBadDebt(address borrower) internal returns (uint256 loss) {
        uint256 shares = debtSharesOf[borrower];
        if (shares == 0) return 0;
        loss = _debtFromShares(shares, borrowIndexRay);
        debtSharesOf[borrower] = 0;
        totalDebtShares -= shares;
        emit BadDebtWrittenOff(borrower, loss);
    }

    function _collateralValue(uint256 amount, uint256 price) internal view returns (uint256 value) {
        uint256 underlyingAmount = underlyingCollateral == address(0)
            ? amount : IERC4626Collateral(address(collateral)).convertToAssets(amount);
        uint256 usd18 = underlyingAmount * price / (10 ** underlyingDecimals);
        if (stableDecimals < 18) return usd18 / (10 ** (18 - stableDecimals));
        if (stableDecimals > 18) return usd18 * (10 ** (stableDecimals - 18));
        return usd18;
    }

    function _stableValueToCollateral(uint256 value, uint256 price) internal view returns (uint256 amount) {
        uint256 usd18 = value;
        if (stableDecimals < 18) usd18 = value * (10 ** (18 - stableDecimals));
        if (stableDecimals > 18) usd18 = value / (10 ** (stableDecimals - 18));
        uint256 underlyingAmount = usd18 * (10 ** underlyingDecimals) / price;
        amount = underlyingCollateral == address(0)
            ? underlyingAmount : IERC4626Collateral(address(collateral)).convertToShares(underlyingAmount);
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(to);
        (bool success, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        if (token.balanceOf(to) - beforeBalance != amount) revert UnexpectedTransferAmount();
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(to);
        (bool success, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        if (token.balanceOf(to) - beforeBalance != amount) revert UnexpectedTransferAmount();
    }
}
