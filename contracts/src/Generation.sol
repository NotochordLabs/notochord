// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Specimen} from "./Specimen.sol";

/// @title Generation
/// @notice Records one replicate of Experiment 177.
///
/// Enforced here: the order of steps, population sizes, the selection rule (best
/// half by fitness, ties by lower id), parent pairing shape, and that each drand
/// round was still in the future when it was committed.
///
/// Trusted until the phase 2 verifier exists: fitness values, decisions, genome
/// hashes and drand randomness come from the runner. Anyone can check them off
/// chain with the open simulator, but this contract does not recompute them.
contract Generation is Ownable {
    enum Phase {
        AwaitingGenesisCommit,
        AwaitingGenesis,
        Ready,
        Open,
        Finished
    }

    struct Child {
        uint32 mate;
        bytes32 genomeHash;
    }

    struct Record {
        uint64 drandRound;
        bytes32 drandRandomness;
        bytes32 thoughtsRoot; // rolling hash of the hourly records
        bytes32 fitnessHash;
    }

    Specimen public immutable specimens;
    uint32 public immutable replicate;
    uint32 public immutable selectionSize;
    uint32 public immutable controlSize;
    uint32 public immutable totalGenerations;
    uint32 public immutable hoursPerGeneration;
    uint32 public immutable genomeSize;
    uint64 public immutable drandGenesisTime;
    uint64 public immutable drandPeriod;
    /// @notice Commitment to the protocol, code version and connectome used by the runner.
    bytes32 public immutable protocolHash;

    Phase public phase;
    uint32 public generation;
    uint32 public hoursRecorded;
    uint64 public genesisDrandRound;
    bytes32 public holdoutHash;

    uint32[] private _selection;
    uint32[] private _control;
    mapping(uint256 generation => Record) private _records;

    event GenesisCommitted(uint64 drandRound);
    event GenesisRecorded(uint64 drandRound, bytes32 drandRandomness);
    event GenerationOpened(uint32 indexed generation, uint64 drandRound);
    /// @param decisions one byte per specimen, selection first: 0 hold, 1 buy, 2 sell
    /// @param fired one byte per specimen: neurons fired during the thought
    event Thought(uint32 indexed generation, uint32 indexed hour, bytes32 inputHash, bytes decisions, bytes fired);
    event GenerationClosed(uint32 indexed generation, bytes32 drandRandomness, int32[] selectionFitness, int32[] controlFitness);
    event HoldoutRecorded(bytes32 inputHash, int32[] selectionFitness, int32[] controlFitness);

    error WrongPhase(Phase actual);
    error DrandRoundNotInFuture(uint64 round);
    error DrandRoundNotReached(uint64 round);
    error WrongLength(uint256 actual, uint256 expected);
    error WrongHour(uint32 hour, uint32 expected);
    error BadDecision(uint256 index, uint8 value);
    error HoursMissing(uint32 recorded, uint32 expected);
    error BadEliminated(uint32 id);
    error BadMate(uint32 parent, uint32 mate);
    error HoldoutAlreadyRecorded();

    constructor(
        address runner,
        uint32 replicate_,
        uint32 selectionSize_,
        uint32 controlSize_,
        uint32 totalGenerations_,
        uint32 hoursPerGeneration_,
        uint32 genomeSize_,
        uint64 drandGenesisTime_,
        uint64 drandPeriod_,
        bytes32 protocolHash_
    ) Ownable(runner) {
        specimens = new Specimen();
        replicate = replicate_;
        selectionSize = selectionSize_;
        controlSize = controlSize_;
        totalGenerations = totalGenerations_;
        hoursPerGeneration = hoursPerGeneration_;
        genomeSize = genomeSize_;
        drandGenesisTime = drandGenesisTime_;
        drandPeriod = drandPeriod_;
        protocolHash = protocolHash_;
    }

    modifier inPhase(Phase expected) {
        if (phase != expected) revert WrongPhase(phase);
        _;
    }

    /// @notice Unix time at which a drand round is published.
    function drandRoundTime(uint64 round) public view returns (uint256) {
        return uint256(drandGenesisTime) + (uint256(round) - 1) * drandPeriod;
    }

    /// @notice Fixes the round that will seed genesis before its value can be known.
    function commitGenesis(uint64 drandRound) external onlyOwner inPhase(Phase.AwaitingGenesisCommit) {
        _requireFuture(drandRound);
        genesisDrandRound = drandRound;
        phase = Phase.AwaitingGenesis;
        emit GenesisCommitted(drandRound);
    }

    function recordGenesis(bytes32 drandRandomness, bytes32[] calldata selectionHashes, bytes32[] calldata controlHashes)
        external
        onlyOwner
        inPhase(Phase.AwaitingGenesis)
    {
        _requireReached(genesisDrandRound);
        _requireLength(selectionHashes.length, selectionSize);
        _requireLength(controlHashes.length, controlSize);
        for (uint256 i; i < selectionHashes.length; ++i) {
            _selection.push(specimens.register(Specimen.Population.Selection, 0, 0, 0, selectionHashes[i]));
        }
        for (uint256 i; i < controlHashes.length; ++i) {
            _control.push(specimens.register(Specimen.Population.Control, 0, 0, 0, controlHashes[i]));
        }
        phase = Phase.Ready;
        emit GenesisRecorded(genesisDrandRound, drandRandomness);
    }

    /// @notice Starts the current generation and fixes the round that will seed its reproduction.
    function open(uint64 drandRound) external onlyOwner inPhase(Phase.Ready) {
        _requireFuture(drandRound);
        _records[generation].drandRound = drandRound;
        hoursRecorded = 0;
        phase = Phase.Open;
        emit GenerationOpened(generation, drandRound);
    }

    function recordThought(uint32 hour, bytes32 inputHash, bytes calldata decisions, bytes calldata fired)
        external
        onlyOwner
        inPhase(Phase.Open)
    {
        if (hour != hoursRecorded) revert WrongHour(hour, hoursRecorded);
        if (hour >= hoursPerGeneration) revert WrongHour(hour, hoursPerGeneration - 1);
        uint256 size = uint256(selectionSize) + controlSize;
        _requireLength(decisions.length, size);
        _requireLength(fired.length, size);
        for (uint256 i; i < size; ++i) {
            if (uint8(decisions[i]) > 2) revert BadDecision(i, uint8(decisions[i]));
        }
        Record storage r = _records[generation];
        r.thoughtsRoot = keccak256(abi.encodePacked(r.thoughtsRoot, hour, inputHash, decisions, fired));
        hoursRecorded = hour + 1;
        emit Thought(generation, hour, inputHash, decisions, fired);
    }

    /// @notice Ends the generation. Selection survivors are computed here, not supplied.
    /// @param controlEliminated ascending ids; chosen off chain from the drand value
    /// @param selectionChildren one per eliminated specimen, parent implied by order
    /// @dev On the last generation the eliminated and child arrays must be empty.
    function close(
        bytes32 drandRandomness,
        int32[] calldata selectionFitness,
        int32[] calldata controlFitness,
        uint32[] calldata controlEliminated,
        Child[] calldata selectionChildren,
        Child[] calldata controlChildren
    ) external onlyOwner inPhase(Phase.Open) {
        if (hoursRecorded != hoursPerGeneration) revert HoursMissing(hoursRecorded, hoursPerGeneration);
        _requireLength(selectionFitness.length, selectionSize);
        _requireLength(controlFitness.length, controlSize);

        uint32 g = generation;
        Record storage r = _records[g];
        _requireReached(r.drandRound);
        r.drandRandomness = drandRandomness;
        r.fitnessHash = keccak256(abi.encode(selectionFitness, controlFitness));
        emit GenerationClosed(g, drandRandomness, selectionFitness, controlFitness);

        if (g + 1 == totalGenerations) {
            _requireLength(controlEliminated.length, 0);
            _requireLength(selectionChildren.length, 0);
            _requireLength(controlChildren.length, 0);
            phase = Phase.Finished;
            return;
        }

        // Children must be registered selection first: that is the simulator's id order.
        uint32[] memory selectionSurvivors = _selectSurvivors(selectionFitness, g);
        uint32[] memory controlSurvivors = _applyControlElimination(controlEliminated, g);
        _replace(_selection, selectionSurvivors, selectionChildren, Specimen.Population.Selection, g + 1);
        _replace(_control, controlSurvivors, controlChildren, Specimen.Population.Control, g + 1);

        generation = g + 1;
        phase = Phase.Ready;
    }

    /// @notice Records the final populations' fitness on the unseen week.
    function recordHoldout(bytes32 inputHash, int32[] calldata selectionFitness, int32[] calldata controlFitness)
        external
        onlyOwner
        inPhase(Phase.Finished)
    {
        if (holdoutHash != bytes32(0)) revert HoldoutAlreadyRecorded();
        _requireLength(selectionFitness.length, selectionSize);
        _requireLength(controlFitness.length, controlSize);
        holdoutHash = keccak256(abi.encode(inputHash, selectionFitness, controlFitness));
        emit HoldoutRecorded(inputHash, selectionFitness, controlFitness);
    }

    function selection() external view returns (uint32[] memory) {
        return _selection;
    }

    function control() external view returns (uint32[] memory) {
        return _control;
    }

    function recordOf(uint256 generation_) external view returns (Record memory) {
        return _records[generation_];
    }

    /// @dev Keeps the best half: higher fitness first, lower id on ties. Returned ascending by id.
    function _selectSurvivors(int32[] calldata fitness, uint32 g) private returns (uint32[] memory survivors) {
        uint32[] memory pop = _selection;
        uint256 n = pop.length;
        uint256[] memory order = new uint256[](n);
        for (uint256 i = 1; i < n; ++i) {
            uint256 current = i;
            uint256 j = i;
            // pop is ascending by id, so an existing earlier entry wins a tie.
            while (j > 0 && fitness[order[j - 1]] < fitness[current]) {
                order[j] = order[j - 1];
                --j;
            }
            order[j] = current;
        }
        uint256 half = n / 2;
        bool[] memory eliminated = new bool[](n);
        for (uint256 k = half; k < n; ++k) {
            eliminated[order[k]] = true;
        }
        survivors = new uint32[](half);
        uint256 s;
        for (uint256 i; i < n; ++i) {
            if (eliminated[i]) specimens.markEliminated(pop[i], g);
            else survivors[s++] = pop[i];
        }
    }

    function _applyControlElimination(uint32[] calldata eliminated, uint32 g) private returns (uint32[] memory survivors) {
        uint32[] memory pop = _control;
        uint256 half = pop.length / 2;
        _requireLength(eliminated.length, pop.length - half);
        survivors = new uint32[](half);
        uint256 e;
        uint256 s;
        for (uint256 i; i < pop.length; ++i) {
            if (e < eliminated.length && eliminated[e] == pop[i]) {
                specimens.markEliminated(pop[i], g);
                ++e;
            } else if (s < half) {
                survivors[s++] = pop[i];
            } else {
                // More survivors than allowed: an eliminated id was unknown or out of order.
                revert BadEliminated(e < eliminated.length ? eliminated[e] : pop[i]);
            }
        }
        if (e != eliminated.length) revert BadEliminated(eliminated[e]);
    }

    /// @dev Survivor k parents child k (wrapping); its mate must be a different survivor.
    function _replace(
        uint32[] storage pop,
        uint32[] memory survivors,
        Child[] calldata children,
        Specimen.Population population,
        uint32 born
    ) private {
        _requireLength(children.length, pop.length - survivors.length);
        uint256 size = pop.length;
        for (uint256 i; i < survivors.length; ++i) {
            pop[i] = survivors[i];
        }
        for (uint256 k; k < children.length; ++k) {
            uint32 parent = survivors[k % survivors.length];
            uint32 mate = children[k].mate;
            if (mate == parent || !_contains(survivors, mate)) revert BadMate(parent, mate);
            pop[survivors.length + k] = specimens.register(population, born, parent, mate, children[k].genomeHash);
        }
        assert(pop.length == size);
    }

    function _contains(uint32[] memory ascending, uint32 id) private pure returns (bool) {
        for (uint256 i; i < ascending.length; ++i) {
            if (ascending[i] == id) return true;
            if (ascending[i] > id) return false;
        }
        return false;
    }

    function _requireFuture(uint64 round) private view {
        if (round == 0 || drandRoundTime(round) <= block.timestamp) revert DrandRoundNotInFuture(round);
    }

    function _requireReached(uint64 round) private view {
        if (drandRoundTime(round) > block.timestamp) revert DrandRoundNotReached(round);
    }

    function _requireLength(uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert WrongLength(actual, expected);
    }
}
