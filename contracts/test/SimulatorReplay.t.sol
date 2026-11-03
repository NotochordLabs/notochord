// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Fossil} from "../src/Fossil.sol";
import {Generation} from "../src/Generation.sol";
import {Specimen} from "../src/Specimen.sol";

/// @notice Replays 10 real generations from the simulator (replicate 1). The contract
/// computes selection itself, so it must reach the populations of the saved fossil.
/// Regenerate the fixture with scripts/export-chain-fixture.ts.
contract SimulatorReplayTest is Test {
    using stdJson for string;

    function _ints(string memory json, string memory key) internal pure returns (int32[] memory out) {
        int256[] memory raw = json.readIntArray(key);
        out = new int32[](raw.length);
        for (uint256 i; i < raw.length; ++i) out[i] = int32(raw[i]);
    }

    function _uints(string memory json, string memory key) internal pure returns (uint32[] memory out) {
        uint256[] memory raw = json.readUintArray(key);
        out = new uint32[](raw.length);
        for (uint256 i; i < raw.length; ++i) out[i] = uint32(raw[i]);
    }

    function _kids(string memory json, string memory prefix) internal pure returns (Generation.Child[] memory c) {
        uint32[] memory mates = _uints(json, string.concat(prefix, "ChildMates"));
        bytes32[] memory hashes = json.readBytes32Array(string.concat(prefix, "ChildHashes"));
        c = new Generation.Child[](mates.length);
        for (uint256 i; i < mates.length; ++i) c[i] = Generation.Child(mates[i], hashes[i]);
    }

    function _same(uint32[] memory a, uint32[] memory b, string memory label) internal pure {
        assertEq(keccak256(abi.encode(a)), keccak256(abi.encode(b)), label);
    }

    function _close(Generation gen, string memory json, string memory p, bytes32 randomness) internal {
        gen.close(
            randomness,
            _ints(json, string.concat(p, "selectionFitness")),
            _ints(json, string.concat(p, "controlFitness")),
            _uints(json, string.concat(p, "controlEliminated")),
            _kids(json, string.concat(p, "selection")),
            _kids(json, string.concat(p, "control"))
        );
    }

    function test_ReplaysRealRun() public {
        string memory json = vm.readFile("test/fixtures/r1-gen0-10.json");
        uint32 genomeSize = uint32(json.readUint(".genomeSize"));
        uint64 drandStart = 1_000_000;
        vm.warp(drandStart + 1);
        address runner = makeAddr("runner");
        Generation gen = new Generation(runner, 1, 64, 16, 100, 24, genomeSize, drandStart, 3, keccak256("protocol"));
        Specimen specimens = gen.specimens();
        Fossil fossil = new Fossil(gen);
        vm.startPrank(runner);

        uint64 round = 1000;
        gen.commitGenesis(round);
        vm.warp(gen.drandRoundTime(round));
        gen.recordGenesis(bytes32(uint256(1)), json.readBytes32Array(".genesis.selection"), json.readBytes32Array(".genesis.control"));

        bytes memory blank = new bytes(80);
        for (uint256 g; g < 10; ++g) {
            string memory p = string.concat(".generations[", vm.toString(g), "].");
            _same(gen.selection(), _uints(json, string.concat(p, "selectionIds")), "selection before");
            _same(gen.control(), _uints(json, string.concat(p, "controlIds")), "control before");

            round += 100;
            gen.open(round);
            for (uint32 h; h < 24; ++h) gen.recordThought(h, keccak256(abi.encode(g, h)), blank, blank);
            vm.warp(gen.drandRoundTime(round));
            _close(gen, json, p, bytes32(g));

            uint32[] memory eliminated = _uints(json, string.concat(p, "selectionEliminated"));
            assertEq(eliminated.length, 32);
            for (uint256 i; i < eliminated.length; ++i) assertEq(specimens.record(eliminated[i]).diedAt, g);
            uint32[] memory born = _uints(json, string.concat(p, "selectionChildIds"));
            assertEq(specimens.record(born[0]).born, g + 1);
            assertEq(born.length, 32);
        }
        vm.stopPrank();

        assertEq(gen.generation(), 10);
        _same(gen.selection(), _uints(json, ".final.selectionIds"), "final selection");
        _same(gen.control(), _uints(json, ".final.controlIds"), "final control");

        // The real 3442-byte genome from fossil gen-010 is accepted and reads back intact.
        uint32[] memory ids = new uint32[](1);
        ids[0] = uint32(json.readUint(".final.sampleId"));
        bytes[] memory genomes = new bytes[](1);
        genomes[0] = json.readBytes(".final.sampleGenome");
        assertEq(sha256(genomes[0]), json.readBytes32(".final.sampleHash"));
        uint256 before = gasleft();
        fossil.record(10, ids, genomes);
        emit log_named_uint("gas: one fossil genome", before - gasleft());
        assertEq(fossil.genomeOf(10, ids[0]), genomes[0]);
    }
}
