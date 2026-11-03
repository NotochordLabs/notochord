// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ThoughtVerifier
/// @notice Recomputes one thought on the EVM from a public genome and public senses.
/// This is a second implementation of the brain, separate from the TypeScript one.
/// It changes no experiment state and has no owner. Anyone can call it for free with
/// eth_call and compare the answer with the Thought event the runner published.
/// @dev Mirrors src/brain.ts: integers only, the same iteration order.
contract ThoughtVerifier {
    uint256 public constant STEPS = 32;
    int256 private constant V_MIN = -1024;
    int256 private constant DRIVE_MAX = 512;
    int256 private constant MARGIN = 2;
    uint256 private constant INHIBITORY_BELOW = 51;

    uint256 public immutable cells;
    uint256 public immutable edges;
    /// @dev [rowPtr: 2 bytes x (cells+1)] [dst: 1 byte x edges] [src: 1 byte x edges] [base: 1 byte x edges] [5 role lengths] [role cells]
    address private immutable _blob;

    error BadGenome(uint256 length, uint256 expected);

    constructor(uint256 cells_, uint256 edges_, bytes memory wiring) {
        cells = cells_;
        edges = edges_;
        bytes memory init = abi.encodePacked(hex"61", uint16(wiring.length), hex"600e60003961", uint16(wiring.length), hex"6000f3", wiring);
        address blob;
        assembly ("memory-safe") {
            blob := create(0, add(init, 32), mload(init))
        }
        require(blob != address(0), "wiring not stored");
        _blob = blob;
    }

    struct Thought {
        int8 decision;
        uint16 fired;
        uint32 motorL;
        uint32 motorR;
        bytes32 genomeHash;
    }

    /// @param r1 last hour return in bps @param r4 last four hours return in bps @param dv volume change in bps
    function think(bytes calldata genome, int32 r1, int32 r4, int32 dv) external view returns (Thought memory out) {
        uint256 n = cells;
        uint256 m = edges;
        if (genome.length != m + 2 * n) revert BadGenome(genome.length, m + 2 * n);
        bytes memory w = _blob.code;
        out.genomeHash = sha256(genome);
        (int256[] memory eff, int256[] memory thr) = _express(genome, w, n, m);
        int256[3] memory drive = [
            _cap(_pos(r1) * 8 + _pos(r4) * 2),
            _cap(_pos(-int256(r1)) * 8 + _pos(-int256(r4)) * 2),
            _cap(_abs(dv) >> 3)
        ];
        (out.motorL, out.motorR, out.fired) = _run(w, eff, thr, drive, n, m);
        int256 diff = int256(uint256(out.motorR)) - int256(uint256(out.motorL));
        out.decision = diff > MARGIN ? int8(1) : diff < -MARGIN ? int8(-1) : int8(0);
    }

    function _express(bytes calldata genome, bytes memory w, uint256 n, uint256 m)
        private
        pure
        returns (int256[] memory eff, int256[] memory thr)
    {
        unchecked {
            uint256 srcAt = (n + 1) * 2 + m;
            uint256 baseAt = srcAt + m;
            eff = new int256[](m);
            for (uint256 e = 0; e < m; e++) {
                int256 mag = int256((uint256(uint8(w[baseAt + e])) * uint256(uint8(genome[e]))) >> 7);
                eff[e] = uint8(genome[m + n + uint8(w[srcAt + e])]) < INHIBITORY_BELOW ? -mag : mag;
            }
            thr = new int256[](n);
            for (uint256 i = 0; i < n; i++) thr[i] = 48 + int256(uint256(uint8(genome[m + i]))) * 4;
        }
    }

    function _bounds(bytes memory w, uint256 at) private pure returns (uint256[6] memory b) {
        b[0] = at + 5;
        for (uint256 k = 0; k < 5; k++) b[k + 1] = b[k] + uint8(w[at + k]);
    }

    struct State {
        int256[] v;
        int256[] cur;
        bool[] spk;
        bool[] next;
        bool[] ever;
    }

    function _run(bytes memory w, int256[] memory eff, int256[] memory thr, int256[3] memory drive, uint256 n, uint256 m)
        private
        pure
        returns (uint32 motorL, uint32 motorR, uint16 fired)
    {
        unchecked {
            uint256 dstAt = (n + 1) * 2;
            uint256[6] memory b = _bounds(w, dstAt + 3 * m);
            State memory st = State(new int256[](n), new int256[](n), new bool[](n), new bool[](n), new bool[](n));
            for (uint256 step = 0; step < STEPS; step++) {
                _propagate(w, eff, st.cur, st.spk, dstAt);
                _sense(w, b, st.cur, drive);
                _integrate(st.v, st.cur, thr, st.next, st.ever);
                motorL += _count(w, st.next, b[3], b[4]);
                motorR += _count(w, st.next, b[4], b[5]);
                (st.spk, st.next) = (st.next, st.spk);
            }
            for (uint256 i = 0; i < n; i++) if (st.ever[i]) fired++;
        }
    }

    function _sense(bytes memory w, uint256[6] memory b, int256[] memory cur, int256[3] memory drive) private pure {
        unchecked {
            for (uint256 r = 0; r < 3; r++) {
                for (uint256 k = b[r]; k < b[r + 1]; k++) cur[uint8(w[k])] += drive[r];
            }
        }
    }

    function _count(bytes memory w, bool[] memory spikes, uint256 from, uint256 to) private pure returns (uint32 c) {
        unchecked {
            for (uint256 k = from; k < to; k++) if (spikes[uint8(w[k])]) c++;
        }
    }

    function _propagate(bytes memory w, int256[] memory eff, int256[] memory cur, bool[] memory spk, uint256 dstAt) private pure {
        unchecked {
            uint256 n = cur.length;
            for (uint256 i = 0; i < n; i++) cur[i] = 0;
            for (uint256 i = 0; i < n; i++) {
                if (!spk[i]) continue;
                uint256 from = (uint256(uint8(w[2 * i])) << 8) | uint8(w[2 * i + 1]);
                uint256 to = (uint256(uint8(w[2 * i + 2])) << 8) | uint8(w[2 * i + 3]);
                for (uint256 e = from; e < to; e++) cur[uint8(w[dstAt + e])] += eff[e];
            }
        }
    }

    function _integrate(int256[] memory v, int256[] memory cur, int256[] memory thr, bool[] memory next, bool[] memory ever) private pure {
        unchecked {
            for (uint256 i = 0; i < v.length; i++) {
                int256 x = v[i] - (v[i] >> 2) + cur[i];
                if (x < V_MIN) x = V_MIN;
                if (x >= thr[i]) {
                    next[i] = true;
                    ever[i] = true;
                    x = 0;
                } else {
                    next[i] = false;
                }
                v[i] = x;
            }
        }
    }

    function _pos(int256 x) private pure returns (int256) {
        return x > 0 ? x : int256(0);
    }

    function _abs(int256 x) private pure returns (int256) {
        return x < 0 ? -x : x;
    }

    function _cap(int256 x) private pure returns (int256) {
        return x > DRIVE_MAX ? DRIVE_MAX : x;
    }
}
