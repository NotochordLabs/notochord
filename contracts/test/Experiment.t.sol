// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Fossil} from "../src/Fossil.sol";
import {Generation} from "../src/Generation.sol";
import {Specimen} from "../src/Specimen.sol";

/// @dev Small population rules: 4 selection + 2 control, 3 generations, 2 hours.
contract ExperimentTest is Test {
    uint64 constant DRAND_GENESIS = 1_000_000;
    uint64 constant PERIOD = 3;
    address runner = makeAddr("runner");
    address alice = makeAddr("alice");

    Generation gen;
    Specimen specimens;
    Fossil fossil;
    uint64 nextRound = 100;

    function setUp() public {
        vm.warp(DRAND_GENESIS + 1);
        gen = new Generation(runner, 1, 4, 2, 3, 2, 8, DRAND_GENESIS, PERIOD, keccak256("protocol"));
        specimens = gen.specimens();
        fossil = new Fossil(gen);
        vm.startPrank(runner);
    }

    function _genome(uint256 seed) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes8(keccak256(abi.encode(seed))));
    }

    function _reach(uint64 round) internal {
        vm.warp(gen.drandRoundTime(round));
    }

    function _genesis() internal {
        gen.commitGenesis(nextRound);
        _reach(nextRound);
        nextRound += 100;
        bytes32[] memory s = new bytes32[](4);
        bytes32[] memory c = new bytes32[](2);
        for (uint256 i; i < 4; ++i) s[i] = sha256(_genome(i + 1));
        for (uint256 i; i < 2; ++i) c[i] = sha256(_genome(i + 5));
        gen.recordGenesis(keccak256("r"), s, c);
    }

    function _openAndThink() internal {
        gen.open(nextRound);
        for (uint32 h; h < 2; ++h) {
            gen.recordThought(h, keccak256(abi.encode(h)), hex"000102000102", hex"010203040506");
        }
        _reach(nextRound);
        nextRound += 100;
    }

    function _fit(int32 a, int32 b, int32 c, int32 d) internal pure returns (int32[] memory f) {
        f = new int32[](4);
        (f[0], f[1], f[2], f[3]) = (a, b, c, d);
    }

    function _fit2() internal pure returns (int32[] memory f) {
        f = new int32[](2);
        (f[0], f[1]) = (1, 2);
    }

    function _one(uint32 id) internal pure returns (uint32[] memory a) {
        a = new uint32[](1);
        a[0] = id;
    }

    function _children(uint32 m0, uint32 m1) internal pure returns (Generation.Child[] memory c) {
        c = new Generation.Child[](2);
        c[0] = Generation.Child(m0, sha256(_genome(100)));
        c[1] = Generation.Child(m1, sha256(_genome(101)));
    }

    function test_StepsMustRunInOrder() public {
        vm.expectRevert(abi.encodeWithSelector(Generation.WrongPhase.selector, Generation.Phase.AwaitingGenesisCommit));
        gen.open(nextRound);
        _genesis();
        gen.open(nextRound);
        vm.expectRevert(abi.encodeWithSelector(Generation.WrongHour.selector, 1, 0));
        gen.recordThought(1, bytes32(0), hex"000000000000", hex"000000000000");
    }

    function test_OnlyRunnerCanWrite() public {
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        gen.commitGenesis(nextRound);
    }

    function test_DrandRoundMustBeInFutureWhenCommitted() public {
        uint64 past = 1;
        vm.expectRevert(abi.encodeWithSelector(Generation.DrandRoundNotInFuture.selector, past));
        gen.commitGenesis(past);
        vm.expectRevert(abi.encodeWithSelector(Generation.DrandRoundNotInFuture.selector, uint64(0)));
        gen.commitGenesis(0);
    }

    function test_GenesisWaitsForItsDrandRound() public {
        gen.commitGenesis(nextRound);
        bytes32[] memory s = new bytes32[](4);
        bytes32[] memory c = new bytes32[](2);
        vm.expectRevert(abi.encodeWithSelector(Generation.DrandRoundNotReached.selector, nextRound));
        gen.recordGenesis(bytes32(0), s, c);
    }

    function test_CloseNeedsAllHours() public {
        _genesis();
        gen.open(nextRound);
        vm.expectRevert(abi.encodeWithSelector(Generation.HoursMissing.selector, 0, 2));
        gen.close(bytes32(0), _fit(1, 2, 3, 4), _fit2(), new uint32[](0), new Generation.Child[](0), new Generation.Child[](0));
    }

    function test_RejectsBadDecisionAndWrongLengths() public {
        _genesis();
        gen.open(nextRound);
        vm.expectRevert(abi.encodeWithSelector(Generation.BadDecision.selector, 0, 3));
        gen.recordThought(0, bytes32(0), hex"030000000000", hex"000000000000");
        vm.expectRevert(abi.encodeWithSelector(Generation.WrongLength.selector, 1, 6));
        gen.recordThought(0, bytes32(0), hex"00", hex"000000000000");
    }

    function test_FinalGenerationHasNoReproductionAndHoldoutIsOnce() public {
        Generation g2 = new Generation(runner, 1, 4, 2, 1, 2, 8, DRAND_GENESIS, PERIOD, bytes32(0));
        gen = g2;
        _genesis();
        _openAndThink();
        gen.close(bytes32(0), _fit(1, 2, 3, 4), _fit2(), new uint32[](0), new Generation.Child[](0), new Generation.Child[](0));
        assertEq(uint8(gen.phase()), uint8(Generation.Phase.Finished));
        gen.recordHoldout(keccak256("week"), _fit(1, 2, 3, 4), _fit2());
        vm.expectRevert(Generation.HoldoutAlreadyRecorded.selector);
        gen.recordHoldout(keccak256("week"), _fit(1, 2, 3, 4), _fit2());
    }

    function test_EliminationAndFossilState() public {
        Generation g2 = new Generation(runner, 1, 4, 4, 2, 2, 8, DRAND_GENESIS, PERIOD, bytes32(0));
        gen = g2;
        specimens = gen.specimens();
        fossil = new Fossil(gen);
        gen.commitGenesis(nextRound);
        _reach(nextRound);
        nextRound += 100;
        bytes32[] memory s = new bytes32[](4);
        bytes32[] memory c = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            s[i] = sha256(_genome(i + 1));
            c[i] = sha256(_genome(i + 5));
        }
        gen.recordGenesis(bytes32(0), s, c);
        gen.open(nextRound);
        for (uint32 h; h < 2; ++h) gen.recordThought(h, bytes32(0), new bytes(8), new bytes(8));
        _reach(nextRound);
        nextRound += 100;
        int32[] memory ctlFit = _fit(0, 0, 0, 0);
        uint32[] memory dead = new uint32[](2);
        (dead[0], dead[1]) = (5, 6);
        // Ids 2, 3 and 4 tie: the lowest id survives next to the best specimen.
        gen.close(bytes32(0), _fit(9, 5, 5, 5), ctlFit, dead, _children(2, 1), _children(8, 7));
        vm.stopPrank();

        assertEq(gen.selection()[0], 1);
        assertEq(gen.selection()[1], 2);
        assertEq(specimens.record(3).diedAt, 0);
        vm.expectRevert(abi.encodeWithSelector(Specimen.UnknownSpecimen.selector, 999));
        specimens.record(999);

        // Fossil: anyone may submit, wrong bytes are refused, identical genomes share a blob.
        uint32[] memory ids = _one(3);
        bytes[] memory genomes = new bytes[](1);
        genomes[0] = _genome(4);
        vm.expectRevert(abi.encodeWithSelector(Fossil.HashMismatch.selector, 3));
        fossil.record(0, ids, genomes);
        genomes[0] = _genome(3);
        fossil.record(0, ids, genomes);
        assertEq(fossil.genomeOf(0, 3), _genome(3));
        vm.expectRevert(abi.encodeWithSelector(Fossil.AlreadyRecorded.selector, 3));
        fossil.record(0, ids, genomes);
        vm.expectRevert(abi.encodeWithSelector(Fossil.NotInGeneration.selector, 3, 1));
        fossil.record(1, ids, genomes);
        assertFalse(fossil.isComplete(0));
    }

    function test_RejectsBadControlEliminationAndMates() public {
        Generation g2 = new Generation(runner, 1, 4, 4, 2, 2, 8, DRAND_GENESIS, PERIOD, bytes32(0));
        gen = g2;
        gen.commitGenesis(nextRound);
        _reach(nextRound);
        nextRound += 100;
        gen.recordGenesis(bytes32(0), new bytes32[](4), new bytes32[](4));
        gen.open(nextRound);
        for (uint32 h; h < 2; ++h) gen.recordThought(h, bytes32(0), new bytes(8), new bytes(8));
        _reach(nextRound);
        int32[] memory f = _fit(4, 3, 2, 1);
        int32[] memory cf = _fit(0, 0, 0, 0);
        // Built first: the SHA-256 precompile call would otherwise satisfy expectRevert.
        Generation.Child[] memory ok = _children(2, 1);
        Generation.Child[] memory okControl = _children(8, 7);
        Generation.Child[] memory self = _children(1, 1);
        Generation.Child[] memory outsider = _children(3, 1);

        uint32[] memory dead = new uint32[](2);
        (dead[0], dead[1]) = (1, 5); // id 1 is not in the control population
        vm.expectRevert(abi.encodeWithSelector(Generation.BadEliminated.selector, 1));
        gen.close(bytes32(0), f, cf, dead, ok, okControl);

        (dead[0], dead[1]) = (6, 5); // not ascending
        vm.expectRevert(abi.encodeWithSelector(Generation.BadEliminated.selector, 5));
        gen.close(bytes32(0), f, cf, dead, ok, okControl);

        (dead[0], dead[1]) = (5, 6);
        vm.expectRevert(abi.encodeWithSelector(Generation.BadMate.selector, 1, 1));
        gen.close(bytes32(0), f, cf, dead, self, okControl);
        vm.expectRevert(abi.encodeWithSelector(Generation.BadMate.selector, 1, 3));
        gen.close(bytes32(0), f, cf, dead, outsider, okControl);
        gen.close(bytes32(0), f, cf, dead, ok, okControl);
        assertEq(gen.generation(), 1);
    }

    /// @dev Whatever the fitness values, the contract keeps the same half as the
    /// simulator's rule: higher fitness first, lower id on ties.
    function testFuzz_SelectionKeepsBestHalf(int32 a, int32 b, int32 c, int32 d) public {
        Generation g2 = new Generation(runner, 1, 4, 4, 2, 2, 8, DRAND_GENESIS, PERIOD, bytes32(0));
        gen = g2;
        gen.commitGenesis(nextRound);
        _reach(nextRound);
        nextRound += 100;
        gen.recordGenesis(bytes32(0), new bytes32[](4), new bytes32[](4));
        gen.open(nextRound);
        for (uint32 h; h < 2; ++h) gen.recordThought(h, bytes32(0), new bytes(8), new bytes(8));
        _reach(nextRound);

        int32[4] memory f = [a, b, c, d];
        uint32 first;
        uint32 second;
        for (uint32 i = 1; i <= 4; ++i) {
            uint256 better;
            for (uint32 j = 1; j <= 4; ++j) {
                if (f[j - 1] > f[i - 1] || (f[j - 1] == f[i - 1] && j < i)) ++better;
            }
            if (better < 2) {
                if (first == 0) first = i;
                else second = i;
            }
        }
        uint32[] memory dead = new uint32[](2);
        (dead[0], dead[1]) = (5, 6);
        gen.close(bytes32(0), _fit(a, b, c, d), _fit(0, 0, 0, 0), dead, _children(second, first), _children(8, 7));
        assertEq(gen.selection()[0], first);
        assertEq(gen.selection()[1], second);
    }
}
