// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only stand-in for the Chainlink VerifierProxy. It returns only preloaded reports.
contract MockStreamsVerifier {
    mapping(bytes32 => bytes) private reports;

    function allow(bytes calldata payload, bytes calldata verifiedReport) external {
        reports[keccak256(payload)] = verifiedReport;
    }

    function verify(bytes calldata payload, bytes calldata) external view returns (bytes memory) {
        bytes memory report = reports[keccak256(payload)];
        require(report.length != 0, "not verified");
        return report;
    }
}
