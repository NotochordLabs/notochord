// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Fossil} from "../src/Fossil.sol";
import {Generation} from "../src/Generation.sol";
import {LabHabitat} from "../src/LabHabitat.sol";

contract Chord is ERC20 {
    constructor() ERC20("Notochord", "CHORD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Takes 1% of every transfer, to check the Lab records what really reached the dead address.
contract TaxedChord is Chord {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 tax = value / 100;
            super._update(from, address(1), tax);
            value -= tax;
        }
        super._update(from, to, value);
    }
}

contract LabHabitatTest is Test {
    uint64 constant DRAND_GENESIS = 1_000_000;
    uint64 constant PERIOD = 3;
    uint64 constant DAY0 = 86400 * 20; // a UTC midnight after drand genesis
    uint256 constant COST = 1_000e18;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address runner = makeAddr("runner");
    address operator = makeAddr("operator");
    address alice = makeAddr("alice");

    Generation gen;
    Fossil fossil;
    Chord chord;
    LabHabitat lab;

    function setUp() public {
        vm.warp(DRAND_GENESIS + 1);
        gen = new Generation(runner, 1, 4, 2, 3, 2, 8, DRAND_GENESIS, PERIOD, keccak256("protocol"));
        fossil = new Fossil(gen);

        // reach generation 0 and store its genomes as fossils
        vm.startPrank(runner);
        gen.commitGenesis(100);
        vm.warp(gen.drandRoundTime(100));
        bytes32[] memory s = new bytes32[](4);
        bytes32[] memory c = new bytes32[](2);
        for (uint256 i; i < 4; ++i) s[i] = sha256(_genome(i + 1));
        for (uint256 i; i < 2; ++i) c[i] = sha256(_genome(i + 5));
        gen.recordGenesis(keccak256("r"), s, c);
        vm.stopPrank();
        uint32[] memory ids = new uint32[](6);
        bytes[] memory genomes = new bytes[](6);
        for (uint32 i; i < 6; ++i) (ids[i], genomes[i]) = (i + 1, _genome(i + 1));
        fossil.record(0, ids, genomes);

        chord = new Chord();
        lab = _deploy(chord);
        chord.mint(alice, 10 * COST);
        vm.prank(alice);
        chord.approve(address(lab), type(uint256).max);
        vm.warp(DAY0 + 5 hours); // day 0 of the Lab
    }

    function _deploy(Chord token) internal returns (LabHabitat) {
        Fossil[] memory f = new Fossil[](1);
        f[0] = fossil;
        return new LabHabitat(IERC20(address(token)), operator, COST, 3, DAY0, DRAND_GENESIS, PERIOD, keccak256("rules"), f);
    }

    function _genome(uint256 seed) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes8(keccak256(abi.encode(seed))));
    }

    function _fossil(uint32 id) internal pure returns (LabHabitat.Parent memory) {
        return LabHabitat.Parent(LabHabitat.Kind.Fossil, 0, 0, id);
    }

    function _labParent(uint32 id) internal pure returns (LabHabitat.Parent memory) {
        return LabHabitat.Parent(LabHabitat.Kind.Lab, 0, 0, id);
    }

    function _one32(uint32 v) internal pure returns (uint32[] memory a) {
        a = new uint32[](1);
        a[0] = v;
    }

    function _oneB(bytes32 v) internal pure returns (bytes32[] memory a) {
        a = new bytes32[](1);
        a[0] = v;
    }

    function _oneI(int32 v) internal pure returns (int32[] memory a) {
        a = new int32[](1);
        a[0] = v;
    }

    function _breed() internal returns (uint32) {
        vm.prank(alice);
        return lab.breed(_fossil(1), _fossil(2));
    }

    function _birth(uint32 id) internal {
        vm.warp(lab.drandRoundTime(lab.brain(id).drandRound));
        vm.prank(operator);
        lab.recordBirths(_one32(id), _oneB(keccak256("rand")), _oneB(keccak256(abi.encode("child", id))));
    }

    // ---------------------------------------------------------------- breeding

    function test_BreedBurnsToDeadAndHoldsNothing() public {
        uint32 id = _breed();
        assertEq(id, 1);
        assertEq(chord.balanceOf(DEAD), COST);
        assertEq(chord.balanceOf(address(lab)), 0);
        assertEq(chord.balanceOf(alice), 9 * COST);
        assertEq(lab.totalBurned(), COST);
        LabHabitat.Brain memory b = lab.brain(id);
        assertEq(b.breeder, alice);
        assertEq(b.day, 1);
        assertEq(uint8(b.status), uint8(LabHabitat.Status.Bred));
        assertEq(b.parentA, sha256(_genome(1)));
        assertEq(b.parentB, sha256(_genome(2)));
    }

    function test_DrandRoundIsPublishedAfterBreedingAtTheRaceStart() public {
        uint32 id = _breed();
        LabHabitat.Brain memory b = lab.brain(id);
        uint256 t = lab.drandRoundTime(b.drandRound);
        assertGt(t, block.timestamp);
        assertGe(t, lab.dayStart(b.day) + lab.DRAW_DELAY());
        assertLt(t, lab.dayStart(b.day) + lab.DRAW_DELAY() + PERIOD);
    }

    function test_LastSecondBreedingStillPrecedesItsDrawByAMinute() public {
        vm.warp(lab.dayStart(1) - 1); // 23:59:59 of day 0
        uint32 id = _breed();
        LabHabitat.Brain memory b = lab.brain(id);
        assertEq(b.day, 1);
        assertGe(lab.drandRoundTime(b.drandRound), block.timestamp + 60);
        vm.warp(lab.dayStart(1)); // midnight: breeding now joins day 2, with a later draw
        uint32 next = _breed();
        assertEq(lab.brain(next).day, 2);
        assertGt(lab.brain(next).drandRound, b.drandRound);
    }

    function test_RejectsUnknownFossilsAndSameParent() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotAFossil.selector, 0, 0, 7));
        lab.breed(_fossil(1), _fossil(7));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotAFossil.selector, 0, 10, 1));
        lab.breed(LabHabitat.Parent(LabHabitat.Kind.Fossil, 0, 10, 1), _fossil(2));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.BadSource.selector, 1));
        lab.breed(LabHabitat.Parent(LabHabitat.Kind.Fossil, 1, 0, 1), _fossil(2));
        vm.expectRevert(LabHabitat.SameParent.selector);
        lab.breed(_fossil(3), _fossil(3));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotBorn.selector, 1));
        lab.breed(_labParent(1), _fossil(2));
        vm.stopPrank();
    }

    function test_OnlyEvolvingFossilsCanBeParents() public {
        // ids 5 and 6 are the control group: stored as fossils, but never selected
        assertTrue(fossil.recorded(0, 5) && fossil.recorded(0, 6));
        uint256 before = chord.balanceOf(alice);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotEvolving.selector, 0, 5));
        lab.breed(_fossil(5), _fossil(1));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotEvolving.selector, 0, 6));
        lab.breed(_fossil(1), _fossil(6));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotEvolving.selector, 0, 5));
        lab.breed(_fossil(5), _fossil(6));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.NotEvolving.selector, 0, 6));
        lab.parentHash(_fossil(6));
        assertEq(chord.balanceOf(alice), before, "nothing burned on a refused breeding");
        assertEq(lab.total(), 0);
        // every selection specimen is accepted, in either position
        for (uint32 id = 1; id <= 4; ++id) assertEq(lab.parentHash(_fossil(id)), sha256(_genome(id)));
        vm.prank(alice);
        lab.breed(_fossil(4), _fossil(1));
        assertEq(lab.total(), 1);
    }

    function test_DailyCap() public {
        _breed();
        _breed();
        _breed();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.DayFull.selector, 1));
        lab.breed(_fossil(1), _fossil(2));
        vm.warp(block.timestamp + 1 days);
        _breed(); // next day has room again
    }

    function test_NeedsApprovalAndBalance() public {
        address bob = makeAddr("bob");
        vm.prank(bob);
        vm.expectRevert();
        lab.breed(_fossil(1), _fossil(2));
    }

    function test_TaxedTokenRecordsWhatReachedDead() public {
        TaxedChord t = new TaxedChord();
        LabHabitat lab2 = _deploy(t);
        t.mint(alice, 10 * COST);
        vm.startPrank(alice);
        t.approve(address(lab2), type(uint256).max);
        lab2.breed(_fossil(1), _fossil(2));
        vm.stopPrank();
        assertEq(lab2.totalBurned(), COST - COST / 100);
        assertEq(t.balanceOf(DEAD), COST - COST / 100);
    }

    // ---------------------------------------------------------------- operator

    function test_BirthWaitsForTheDrandRound() public {
        uint32 id = _breed();
        uint256 at = lab.drandRoundTime(lab.brain(id).drandRound);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.TooEarly.selector, at));
        lab.recordBirths(_one32(id), _oneB(0), _oneB(0));
        _birth(id);
        assertEq(uint8(lab.brain(id).status), uint8(LabHabitat.Status.Born));
    }

    function test_ResultsWaitForTheDayToClose() public {
        uint32 id = _breed();
        _birth(id);
        uint256 at = lab.dayStart(2) + 1 hours;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.TooEarly.selector, at));
        lab.recordResults(_one32(id), _oneI(120), _oneI(40), _oneB(keccak256("d")));
        vm.warp(at);
        vm.prank(operator);
        lab.recordResults(_one32(id), _oneI(120), _oneI(41), _oneB(keccak256("d")));
        LabHabitat.Brain memory b = lab.brain(id);
        assertEq(uint8(b.status), uint8(LabHabitat.Status.Raced));
        assertEq(b.fitness, 100); // 120 - 41 >> 1, as in the experiment
    }

    function test_StepsCannotRepeatOrSkip() public {
        uint32 id = _breed();
        vm.warp(lab.dayStart(3));
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.WrongStatus.selector, id, LabHabitat.Status.Bred));
        lab.recordResults(_one32(id), _oneI(0), _oneI(0), _oneB(0));
        lab.recordBirths(_one32(id), _oneB(0), _oneB(keccak256("g")));
        vm.expectRevert(abi.encodeWithSelector(LabHabitat.WrongStatus.selector, id, LabHabitat.Status.Born));
        lab.recordBirths(_one32(id), _oneB(0), _oneB(keccak256("g")));
        vm.stopPrank();
    }

    function test_OnlyOperatorWrites() public {
        uint32 id = _breed();
        vm.warp(lab.dayStart(3));
        vm.startPrank(alice);
        vm.expectRevert(LabHabitat.NotOperator.selector);
        lab.recordBirths(_one32(id), _oneB(0), _oneB(0));
        vm.expectRevert(LabHabitat.NotOperator.selector);
        lab.recordResults(_one32(id), _oneI(0), _oneI(0), _oneB(0));
        vm.expectRevert(LabHabitat.NotOperator.selector);
        lab.close();
        vm.stopPrank();
    }

    function test_LabBrainsCanBeParentsOnceBorn() public {
        uint32 a = _breed();
        uint32 b = _breed();
        _birth(a);
        _birth(b);
        vm.prank(alice);
        uint32 c = lab.breed(_labParent(a), _labParent(b));
        assertEq(lab.brain(c).parentA, lab.brain(a).genomeHash);
        vm.prank(alice);
        vm.expectRevert(LabHabitat.SameParent.selector);
        lab.breed(_labParent(a), _labParent(a));
    }

    function test_CloseStopsBreedingButNotRaces() public {
        uint32 id = _breed();
        vm.prank(operator);
        lab.close();
        vm.prank(alice);
        vm.expectRevert(LabHabitat.LabClosed.selector);
        lab.breed(_fossil(1), _fossil(2));
        _birth(id);
        vm.warp(lab.dayStart(2) + 1 hours);
        vm.prank(operator);
        lab.recordResults(_one32(id), _oneI(1), _oneI(0), _oneB(0));
    }

    function test_LabNeverWritesToTheExperiment() public {
        uint32 g = gen.generation();
        uint8 phase = uint8(gen.phase());
        uint256 count = fossil.countOf(0);
        uint32 id = _breed();
        _birth(id);
        assertEq(gen.generation(), g);
        assertEq(uint8(gen.phase()), phase);
        assertEq(fossil.countOf(0), count);
    }

    function test_State() public {
        _breed();
        (address token, address dead, uint256 cost, uint256 burned, uint32 brains, uint32 day, uint32 tomorrow, uint32 cap, bool closed) = lab.state();
        assertEq(token, address(chord));
        assertEq(dead, DEAD);
        assertEq(cost, COST);
        assertEq(burned, COST);
        assertEq(brains, 1);
        assertEq(day, 0);
        assertEq(tomorrow, 1);
        assertEq(cap, 3);
        assertFalse(closed);
    }

    function test_ConstructorRejectsNonMidnightDayZero() public {
        Fossil[] memory f = new Fossil[](1);
        f[0] = fossil;
        vm.expectRevert(LabHabitat.BadArgs.selector);
        new LabHabitat(IERC20(address(chord)), operator, COST, 3, DAY0 + 1, DRAND_GENESIS, PERIOD, bytes32(0), f);
    }
}
