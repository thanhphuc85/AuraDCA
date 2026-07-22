// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  AuraAttestation — on-chain audit anchor for the Aura DCA agent.
/// @notice After each run the agent writes a keccak256 hash of its committed
///         off-chain ledger (`data/ledger.json`) here. Anyone can recompute
///         `keccak256(bytes of data/ledger.json)` at the matching git commit and
///         compare it to `latestHash` — turning the git-committed audit trail
///         into a tamper-evident, on-chain one.
/// @dev    This contract holds NO funds and touches NO user balances. It records
///         hashes only. The money path stays entirely in Circle Swap Kit +
///         `clampDecision()`; a bug here can never move a token. Writes are
///         restricted to a single `writer` (the agent's Circle wallet address),
///         set once at deploy and immutable thereafter.
contract AuraAttestation {
    /// @notice The only address allowed to record attestations (the agent wallet).
    address public immutable writer;
    /// @notice Number of attestations recorded so far (also the next seq).
    uint256 public count;
    /// @notice The most recent ledger hash anchored on-chain.
    bytes32 public latestHash;
    /// @notice Unix time of the most recent attestation.
    uint256 public latestTimestamp;

    /// @param seq        monotonically increasing attestation index (0-based)
    /// @param ledgerHash keccak256 of the committed ledger bytes
    /// @param ref        a human-locatable reference (the run's ISO timestamp)
    /// @param timestamp  block time the attestation was recorded
    event Attested(uint256 indexed seq, bytes32 indexed ledgerHash, string ref, uint256 timestamp);

    error NotWriter();

    /// @param writer_ the agent's on-chain wallet address (the authorized attester)
    constructor(address writer_) {
        writer = writer_;
    }

    /// @notice Anchor a ledger-state hash on-chain. Restricted to `writer`.
    /// @param ledgerHash keccak256 of the committed `data/ledger.json` bytes
    /// @param ref        the run's ISO timestamp, so the matching commit is findable
    function attest(bytes32 ledgerHash, string calldata ref) external {
        if (msg.sender != writer) revert NotWriter();
        uint256 seq = count;
        latestHash = ledgerHash;
        latestTimestamp = block.timestamp;
        count = seq + 1;
        emit Attested(seq, ledgerHash, ref, block.timestamp);
    }
}
