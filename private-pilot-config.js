export default {
  "kind": "PRIVATE_MAINNET_SYNTHETIC_PRICE_PILOT",
  "chainId": 196,
  "participant": "0x1DcB045123730e606A88380BCe534332F50332d2",
  "stable": "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
  "collateral": "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
  "underlying": "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
  "transactions": [
    {
      "key": "oracle",
      "hash": "0x9ea710cb5f29229102b38423c4a31a8269d8ea99aefcbaa75f57b3253a42b81d",
      "args": [
        "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
        "100000000000000000000"
      ],
      "block": 71667420,
      "status": 1,
      "gasUsed": "257969"
    },
    {
      "key": "pool",
      "hash": "0xeb04bb4abc4d37e71031e730cef85264719b29d3cf6c225098fd782f7ca36077",
      "args": [
        "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
        "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
        "0x75Eab56774d9b3fA49A83BD036177F7635E00Ad4",
        "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
        "0x1DcB045123730e606A88380BCe534332F50332d2"
      ],
      "block": 71667441,
      "status": 1,
      "gasUsed": "2897154"
    }
  ],
  "preflight": {
    "at": "2026-09-26T15:27:10.712Z",
    "issuerSource": "https://api.xstocks.fi/api/v2/public/assets/NVDAx",
    "issuerDeployment": {
      "address": "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
      "network": "XLayer",
      "wrapperAddressV2": "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
      "supportsAtomicSwaps": true,
      "stablecoins": [
        {
          "symbol": "USDG",
          "currency": "USD",
          "network": "XLayer",
          "address": "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8",
          "decimals": 6,
          "issuance": true,
          "redemption": true,
          "supportsAtomicSwaps": true
        },
        {
          "symbol": "USDC",
          "currency": "USD",
          "network": "XLayer",
          "address": "0xb6ceceab302e2e4948951ee7843fc24e92933061",
          "decimals": 6,
          "issuance": true,
          "redemption": true,
          "supportsAtomicSwaps": true
        }
      ]
    },
    "shareRate": "1001701196801074000",
    "balances": {
      "participantOkb": "0.034067780986716456",
      "participantUsdg": "0.0",
      "participantNvda": "0.024216112027935145",
      "deployerOkb": "0.019885227145231769"
    }
  },
  "terms": {
    "testPriceUsd": "100",
    "priceIsMarketData": false,
    "supplyLifetimeUsdg": "0.02",
    "debtCeilingUsdg": "0.01",
    "plannedDrawUsdg": "0.005",
    "plannedWrapNvda": "0.001",
    "nominalAprBps": 100,
    "borrowLtvBps": 2500,
    "liquidationLtvBps": 5000,
    "durationDays": 7
  },
  "compiler": "0.8.26+commit.8a97fa7a.Emscripten.clang",
  "sourceHash": "0xfb91328c9bb361b46648cb5646fc4bbba2309d8ab8e59f24cffb5b087b1ebab8",
  "oracle": "0x75Eab56774d9b3fA49A83BD036177F7635E00Ad4",
  "pool": "0x7539200A18333B77F6C4a2f8a7cbc61dddFb5E08",
  "expiresAt": 1791041277,
  "runtimeCodeHash": "0x800fdb48ebc0f851a006650c2eae7fc80e88e4bc30d8a806ee5501b8d8f8860b",
  "status": "deployed-awaiting-participant-transactions",
  "abi": [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "stable_",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "wrapper_",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "price_",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "underlying_",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "participant_",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [],
      "name": "DebtCeilingExceeded",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FullCloseRequired",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "HealthyPosition",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientCash",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientShares",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidConfiguration",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotOwner",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotPendingOwner",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "Paused",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PilotCapExceeded",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PilotExpired",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PrivateParticipantOnly",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "Reentrancy",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RiskLimit",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RiskUnavailable",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "TransferFailed",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "UnexpectedTransferAmount",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ZeroAmount",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "BadDebtWrittenOff",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "Borrowed",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "CollateralDeposited",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "CollateralWithdrawn",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "borrowIndexRay",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "totalDebt",
          "type": "uint256"
        }
      ],
      "name": "InterestAccrued",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "liquidator",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "repaid",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "seized",
          "type": "uint256"
        }
      ],
      "name": "Liquidated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "lender",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "assets",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "shares",
          "type": "uint256"
        }
      ],
      "name": "LiquiditySupplied",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "lender",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "assets",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "shares",
          "type": "uint256"
        }
      ],
      "name": "LiquidityWithdrawn",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "owner",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "pendingOwner",
          "type": "address"
        }
      ],
      "name": "OwnershipTransferStarted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "previousOwner",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "OwnershipTransferred",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "Repaid",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "bool",
          "name": "borrowPaused",
          "type": "bool"
        },
        {
          "indexed": false,
          "internalType": "bool",
          "name": "supplyPaused",
          "type": "bool"
        }
      ],
      "name": "RiskPauseSet",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "acceptOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "annualRateBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "baseBorrowLtvBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "borrow",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        }
      ],
      "name": "borrowCapacity",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "borrowIndexRay",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "borrowPaused",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "closedSessionFactorBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "collateral",
      "outputs": [
        {
          "internalType": "contract IERC20",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "collateralDecimals",
      "outputs": [
        {
          "internalType": "uint8",
          "name": "",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "collateralOf",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "creditMultiplierBps",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "currentBorrowIndexRay",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "debtCeiling",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        }
      ],
      "name": "debtOf",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "debtSharesOf",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "depositCollateral",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "expiresAt",
      "outputs": [
        {
          "internalType": "uint64",
          "name": "",
          "type": "uint64"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        }
      ],
      "name": "isLiquidatable",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "lastAccruedAt",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "requestedRepay",
          "type": "uint256"
        }
      ],
      "name": "liquidate",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "repaid",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "seized",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "liquidationBonusBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "liquidationLtvBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "liquidityShares",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "minFreshnessBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "minLiquidityBps",
      "outputs": [
        {
          "internalType": "uint16",
          "name": "",
          "type": "uint16"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "oracle",
      "outputs": [
        {
          "internalType": "contract MarketRiskOracle",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "owner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "participant",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "pendingOwner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "repay",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "paid",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "bool",
          "name": "borrowPaused_",
          "type": "bool"
        },
        {
          "internalType": "bool",
          "name": "supplyPaused_",
          "type": "bool"
        }
      ],
      "name": "setRiskPause",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "stable",
      "outputs": [
        {
          "internalType": "contract IERC20",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "stableDecimals",
      "outputs": [
        {
          "internalType": "uint8",
          "name": "",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "suppliedLifetime",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "assets",
          "type": "uint256"
        }
      ],
      "name": "supply",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "shares",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "supplyCap",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "supplyPaused",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalAssets",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalDebt",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalDebtShares",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalLiquidityShares",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "to",
          "type": "address"
        }
      ],
      "name": "transferOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "underlyingCollateral",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "underlyingDecimals",
      "outputs": [
        {
          "internalType": "uint8",
          "name": "",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "withdrawCollateral",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "shares",
          "type": "uint256"
        }
      ],
      "name": "withdrawLiquidity",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "assets",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "borrower",
          "type": "address"
        }
      ],
      "name": "writeOffBadDebt",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "loss",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ]
};
