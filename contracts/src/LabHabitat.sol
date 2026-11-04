// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Fossil} from "./Fossil.sol";
import {Specimen} from "./Specimen.sol";

/// @title LabHabitat
/// @notice Breeding from Experiment 177's fossils. A holder picks two parents,
/// burns $CHORD, and the child races the next UTC day of the live market on paper.
///
/// The experiment never sees any of this. The Lab only reads fossils; it calls no
/// function that writes to the experiment, and the experiment holds no reference to
/// the Lab. Burned tokens go straight to the dead address: the Lab holds none.
///
/// What is enforced here: who bred what, from which parents, which drand round fixes
/// the child's genes (always one published after the breeding), which day it races,
/// how much was burned, and that results only arrive after their day has closed.
/// What is trusted to the operator, and recomputable by anyone with the open code:
/// each child's genome hash and its race result.
contract LabHabitat {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint64 public constant DAY = 1 days;
    /// @notice Candles for the last hour of a day close one hour after it ends.
    uint64 public constant RESULT_DELAY = 1 hours;
    /// @notice The draw that fixes a child's genes comes this long after breeding for its day closes,
    /// so no breeding can land in a block after that draw is public.
    uint64 public constant DRAW_DELAY = 1 minutes;

    enum Kind {
        Fossil,
        Lab
    }

    /// @param source For a fossil: index into `fossils`. Ignored for a Lab brain.
    /// @param generation For a fossil: its generation. Ignored for a Lab brain.
    /// @param id A fossil's specimen id, or a Lab brain id.
    struct Parent {
        Kind kind;
        uint8 source;
        uint32 generation;
        uint32 id;
    }

    enum Status {
        None,
        Bred,
        Born,
        Raced
    }

    struct Brain {
        address breeder;
        uint32 day;
        Status status;
        uint64 drandRound;
        bytes32 parentA; // genome hash of each parent
        bytes32 parentB;
        bytes32 genomeHash;
        bytes32 decisionsHash;
        int32 pnl; // bps, after fees
        int32 maxDrawdown; // bps
        int32 fitness; // pnl - maxDrawdown / 2, as in the experiment
    }

    IERC20 public immutable chord;
    address public immutable operator;
    uint256 public immutable breedCost;
    uint32 public immutable maxPerDay;
    uint64 public immutable dayZero; // a UTC midnight; day d covers [dayZero + d*DAY, +DAY)
    uint64 public immutable drandGenesisTime;
    uint64 public immutable drandPeriod;
    /// @notice Hash of the Lab rules and the code commit that implements them.
    bytes32 public immutable rulesHash;

    /// @notice The experiment's real-wiring replicates. Fixed at deploy.
    Fossil[] private _fossils;

    uint32 public total;
    uint256 public totalBurned;
    bool public closed;
    mapping(uint256 id => Brain) private _brains;
    mapping(uint256 day => uint32) public bredOn;

    event Bred(
        uint32 indexed id,
        address indexed breeder,
        uint32 indexed day,
        uint64 drandRound,
        Parent a,
        Parent b,
        bytes32 parentA,
        bytes32 parentB,
        uint256 burned
    );
    event Born(uint32 indexed id, bytes32 drandRandomness, bytes32 genomeHash);
    event Raced(uint32 indexed id, int32 pnl, int32 maxDrawdown, int32 fitness, bytes32 decisionsHash);
    event Closed();

    error NotOperator();
    error LabClosed();
    error BadSource(uint8 source);
    error NotAFossil(uint8 source, uint32 generation, uint32 id);
    error NotEvolving(uint8 source, uint32 id);
    error NotBorn(uint32 id);
    error SameParent();
    error DayFull(uint32 day);
    error NothingBurned();
    error WrongStatus(uint32 id, Status status);
    error TooEarly(uint256 at);
    error WrongLength();
    error BadArgs();

    constructor(
        IERC20 chord_,
        address operator_,
        uint256 breedCost_,
        uint32 maxPerDay_,
        uint64 dayZero_,
        uint64 drandGenesisTime_,
        uint64 drandPeriod_,
        bytes32 rulesHash_,
        Fossil[] memory fossils_
    ) {
        if (
            address(chord_) == address(0) || operator_ == address(0) || breedCost_ == 0 || maxPerDay_ == 0
                || dayZero_ % DAY != 0 || drandPeriod_ == 0 || fossils_.length == 0 || fossils_.length > type(uint8).max
        ) revert BadArgs();
        chord = chord_;
        operator = operator_;
        breedCost = breedCost_;
        maxPerDay = maxPerDay_;
        dayZero = dayZero_;
        drandGenesisTime = drandGenesisTime_;
        drandPeriod = drandPeriod_;
        rulesHash = rulesHash_;
        for (uint256 i; i < fossils_.length; ++i) _fossils.push(fossils_[i]);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ---------------------------------------------------------------- holders

    /// @notice Burn `breedCost` $CHORD and breed a child from two parents. Needs an
    /// approval of at least `breedCost` for this contract. The child races the next
    /// full UTC day; its genes are fixed by the drand round published at that day's start.
    function breed(Parent calldata a, Parent calldata b) external returns (uint32 id) {
        if (closed) revert LabClosed();
        bytes32 ha = parentHash(a);
        bytes32 hb = parentHash(b);
        if (_same(a, b)) revert SameParent();

        uint32 day = today() + 1;
        if (bredOn[day] >= maxPerDay) revert DayFull(day);
        ++bredOn[day];

        // Measured at the dead address, so a token that taxes transfers is recorded honestly.
        uint256 before = chord.balanceOf(DEAD);
        chord.safeTransferFrom(msg.sender, DEAD, breedCost);
        uint256 burned = chord.balanceOf(DEAD) - before;
        if (burned == 0) revert NothingBurned();
        totalBurned += burned;

        id = _store(day, ha, hb);
        emit Bred(id, msg.sender, day, _brains[id].drandRound, a, b, ha, hb, burned);
    }

    function _store(uint32 day, bytes32 ha, bytes32 hb) private returns (uint32 id) {
        id = ++total;
        Brain storage x = _brains[id];
        x.breeder = msg.sender;
        x.day = day;
        x.status = Status.Bred;
        x.drandRound = drandRoundAt(dayStart(day) + DRAW_DELAY);
        x.parentA = ha;
        x.parentB = hb;
    }

    // ---------------------------------------------------------------- operator

    /// @notice Record children once their drand round is out. The genome is derived
    /// off chain from the parents and the round's randomness; anyone can redo it.
    function recordBirths(uint32[] calldata ids, bytes32[] calldata randomness, bytes32[] calldata genomeHashes)
        external
        onlyOperator
    {
        if (ids.length != randomness.length || ids.length != genomeHashes.length) revert WrongLength();
        for (uint256 i; i < ids.length; ++i) {
            Brain storage x = _brains[ids[i]];
            if (x.status != Status.Bred) revert WrongStatus(ids[i], x.status);
            uint256 at = drandRoundTime(x.drandRound);
            if (block.timestamp < at) revert TooEarly(at);
            x.genomeHash = genomeHashes[i];
            x.status = Status.Born;
            emit Born(ids[i], randomness[i], genomeHashes[i]);
        }
    }

    /// @notice Record race results once the day's last candle has closed.
    function recordResults(
        uint32[] calldata ids,
        int32[] calldata pnl,
        int32[] calldata maxDrawdown,
        bytes32[] calldata decisionsHash
    ) external onlyOperator {
        if (ids.length != pnl.length || ids.length != maxDrawdown.length || ids.length != decisionsHash.length) {
            revert WrongLength();
        }
        for (uint256 i; i < ids.length; ++i) {
            Brain storage x = _brains[ids[i]];
            if (x.status != Status.Born) revert WrongStatus(ids[i], x.status);
            uint256 at = dayStart(x.day + 1) + RESULT_DELAY;
            if (block.timestamp < at) revert TooEarly(at);
            int32 fitness = pnl[i] - (maxDrawdown[i] >> 1);
            (x.pnl, x.maxDrawdown, x.fitness, x.decisionsHash, x.status) =
                (pnl[i], maxDrawdown[i], fitness, decisionsHash[i], Status.Raced);
            emit Raced(ids[i], pnl[i], maxDrawdown[i], fitness, decisionsHash[i]);
        }
    }

    /// @notice Stop new breeding for good. Brains already bred still get born and race.
    function close() external onlyOperator {
        closed = true;
        emit Closed();
    }

    // ---------------------------------------------------------------- views

    /// @notice A parent's genome hash. Reverts unless it is a stored fossil from the selection
    /// population (control specimens exist only to be compared against) or a born Lab brain.
    function parentHash(Parent calldata p) public view returns (bytes32) {
        if (p.kind == Kind.Lab) {
            Brain storage x = _brains[p.id];
            if (x.status != Status.Born && x.status != Status.Raced) revert NotBorn(p.id);
            return x.genomeHash;
        }
        if (p.source >= _fossils.length) revert BadSource(p.source);
        Fossil f = _fossils[p.source];
        if (!f.recorded(p.generation, p.id)) revert NotAFossil(p.source, p.generation, p.id);
        Specimen.Record memory r = f.specimens().record(p.id);
        if (r.population != Specimen.Population.Selection) revert NotEvolving(p.source, p.id);
        return r.genomeHash;
    }

    function brain(uint256 id) external view returns (Brain memory) {
        return _brains[id];
    }

    function fossils() external view returns (Fossil[] memory) {
        return _fossils;
    }

    function today() public view returns (uint32) {
        if (block.timestamp < dayZero) return 0;
        return uint32((block.timestamp - dayZero) / DAY);
    }

    function dayStart(uint32 day) public view returns (uint256) {
        return uint256(dayZero) + uint256(day) * DAY;
    }

    /// @notice First drand round published at or after `time`.
    function drandRoundAt(uint256 time) public view returns (uint64) {
        if (time <= drandGenesisTime) return 1;
        return uint64((time - drandGenesisTime + drandPeriod - 1) / drandPeriod + 1);
    }

    function drandRoundTime(uint64 round) public view returns (uint256) {
        return uint256(drandGenesisTime) + uint256(round - 1) * drandPeriod;
    }

    /// @notice Everything the site needs in one call.
    function state()
        external
        view
        returns (address token, address dead, uint256 cost, uint256 burned, uint32 brains, uint32 day, uint32 tomorrowCount, uint32 cap, bool isClosed)
    {
        uint32 d = today();
        return (address(chord), DEAD, breedCost, totalBurned, total, d, bredOn[d + 1], maxPerDay, closed);
    }

    function _same(Parent calldata a, Parent calldata b) private pure returns (bool) {
        if (a.kind != b.kind) return false;
        if (a.kind == Kind.Lab) return a.id == b.id;
        return a.source == b.source && a.id == b.id;
    }
}
