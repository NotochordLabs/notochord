// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Generation} from "./Generation.sol";
import {Specimen} from "./Specimen.sol";

/// @title Fossil
/// @notice Stores full genomes every 10 generations and for the last generation.
/// Anyone may submit: a genome is accepted only if its SHA-256 matches the hash
/// already recorded for that specimen.
contract Fossil {
    uint32 public constant INTERVAL = 10;

    Generation public immutable experiment;
    Specimen public immutable specimens;

    /// @dev Identical genomes (a control's genesis twin, a survivor across fossils) share one blob.
    mapping(bytes32 genomeHash => address) public blobOf;
    mapping(uint256 generation => mapping(uint256 id => bool)) public recorded;
    mapping(uint256 generation => uint256) public countOf;

    event Fossilized(uint32 indexed generation, uint32 indexed id, bytes32 genomeHash, address blob);

    error NotFossilGeneration(uint32 generation);
    error GenerationNotReached(uint32 generation);
    error NotInGeneration(uint32 id, uint32 generation);
    error WrongGenomeSize(uint256 actual, uint256 expected);
    error HashMismatch(uint32 id);
    error AlreadyRecorded(uint32 id);
    error NotRecorded(uint32 id, uint32 generation);
    error WrongLength();
    error BlobWriteFailed();

    constructor(Generation experiment_) {
        experiment = experiment_;
        specimens = experiment_.specimens();
    }

    function isFossilGeneration(uint32 generation) public view returns (bool) {
        return generation % INTERVAL == 0 || generation + 1 == experiment.totalGenerations();
    }

    /// @notice True once every member of the generation's population has been stored.
    function isComplete(uint32 generation) external view returns (bool) {
        return countOf[generation] == uint256(experiment.selectionSize()) + experiment.controlSize();
    }

    function record(uint32 generation, uint32[] calldata ids, bytes[] calldata genomes) external {
        if (ids.length != genomes.length) revert WrongLength();
        if (!isFossilGeneration(generation)) revert NotFossilGeneration(generation);
        _requireReached(generation);
        uint256 expected = experiment.genomeSize();
        for (uint256 i; i < ids.length; ++i) {
            uint32 id = ids[i];
            if (!specimens.aliveDuring(id, generation)) revert NotInGeneration(id, generation);
            if (recorded[generation][id]) revert AlreadyRecorded(id);
            if (genomes[i].length != expected) revert WrongGenomeSize(genomes[i].length, expected);
            bytes32 hash = sha256(genomes[i]);
            if (hash != specimens.record(id).genomeHash) revert HashMismatch(id);
            address blob = blobOf[hash];
            if (blob == address(0)) {
                blob = _write(genomes[i]);
                blobOf[hash] = blob;
            }
            recorded[generation][id] = true;
            ++countOf[generation];
            emit Fossilized(generation, id, hash, blob);
        }
    }

    function genomeOf(uint32 generation, uint32 id) external view returns (bytes memory genome) {
        if (!recorded[generation][id]) revert NotRecorded(id, generation);
        address blob = blobOf[specimens.record(id).genomeHash];
        uint256 size = blob.code.length - 1;
        genome = new bytes(size);
        assembly ("memory-safe") {
            extcodecopy(blob, add(genome, 32), 1, size)
        }
    }

    function _requireReached(uint32 generation) private view {
        Generation.Phase phase = experiment.phase();
        if (phase == Generation.Phase.AwaitingGenesisCommit || phase == Generation.Phase.AwaitingGenesis) {
            revert GenerationNotReached(generation);
        }
        if (generation > experiment.generation()) revert GenerationNotReached(generation);
    }

    /// @dev Deploys `data` as contract code, behind a STOP byte so it can never run.
    function _write(bytes calldata data) private returns (address blob) {
        bytes memory init = abi.encodePacked(hex"600B5981380380925939F3", hex"00", data);
        assembly ("memory-safe") {
            blob := create(0, add(init, 32), mload(init))
        }
        if (blob == address(0)) revert BlobWriteFailed();
    }
}
