// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ThoughtVerifier} from "../src/ThoughtVerifier.sol";

/// Regenerate the fixture with scripts/export-verifier-fixture.ts.
contract ThoughtVerifierTest is Test {
    using stdJson for string;

    function testAgreesWithTypeScriptBrain() public {
        string memory j = vm.readFile("test/fixtures/thoughts.json");
        ThoughtVerifier verifier = new ThoughtVerifier(j.readUint(".cells"), j.readUint(".edges"), j.readBytes(".wiring"));
        uint256 count = j.readUint(".count");
        for (uint256 i = 0; i < count; i++) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            bytes memory genome = j.readBytes(string.concat(p, ".genome"));
            int32 r1 = int32(j.readInt(string.concat(p, ".r1")));
            int32 r4 = int32(j.readInt(string.concat(p, ".r4")));
            int32 dv = int32(j.readInt(string.concat(p, ".dv")));
            uint256 before = gasleft();
            ThoughtVerifier.Thought memory t = verifier.think(genome, r1, r4, dv);
            console2.log("case", i, "gas", before - gasleft());
            assertEq(int256(t.decision), j.readInt(string.concat(p, ".decision")), "decision");
            assertEq(uint256(t.fired), j.readUint(string.concat(p, ".fired")), "fired");
            assertEq(uint256(t.motorL), j.readUint(string.concat(p, ".motorL")), "motorL");
            assertEq(uint256(t.motorR), j.readUint(string.concat(p, ".motorR")), "motorR");
            assertEq(t.genomeHash, j.readBytes32(string.concat(p, ".hash")), "hash");
        }
    }

    function testRejectsWrongGenomeLength() public {
        string memory j = vm.readFile("test/fixtures/thoughts.json");
        ThoughtVerifier verifier = new ThoughtVerifier(j.readUint(".cells"), j.readUint(".edges"), j.readBytes(".wiring"));
        vm.expectRevert();
        verifier.think(hex"00", 0, 0, 0);
    }
}
