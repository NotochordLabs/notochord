// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Specimen
/// @notice One record per simulated brain. Specimens are the experiment's subjects:
/// nobody owns them, so nothing outside the protocol can bear on the result.
contract Specimen {
    enum Population {
        Selection,
        Control
    }

    struct Record {
        bytes32 genomeHash; // SHA-256 of the genome bytes
        uint32 parentA; // 0 for genesis specimens
        uint32 parentB;
        uint32 born;
        uint32 diedAt; // ALIVE until eliminated
        Population population;
    }

    uint32 public constant ALIVE = type(uint32).max;

    /// @notice The Generation contract that deployed this one; only it can write records.
    address public immutable registrar;
    uint32 public total;
    mapping(uint256 id => Record) private _records;

    event Registered(uint32 indexed id, Population population, uint32 born, uint32 parentA, uint32 parentB, bytes32 genomeHash);
    event Eliminated(uint32 indexed id, uint32 generation);

    error NotRegistrar();
    error UnknownSpecimen(uint256 id);

    constructor() {
        registrar = msg.sender;
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    /// @dev Ids count up from 1, in the same order the simulator hands them out.
    function register(Population population, uint32 born, uint32 parentA, uint32 parentB, bytes32 genomeHash)
        external
        onlyRegistrar
        returns (uint32 id)
    {
        id = ++total;
        _records[id] = Record(genomeHash, parentA, parentB, born, ALIVE, population);
        emit Registered(id, population, born, parentA, parentB, genomeHash);
    }

    function markEliminated(uint32 id, uint32 generation) external onlyRegistrar {
        _records[id].diedAt = generation;
        emit Eliminated(id, generation);
    }

    function record(uint256 id) public view returns (Record memory r) {
        if (id == 0 || id > total) revert UnknownSpecimen(id);
        r = _records[id];
    }

    /// @notice True if the specimen was in the population during `generation`.
    function aliveDuring(uint256 id, uint32 generation) external view returns (bool) {
        Record memory r = record(id);
        return r.born <= generation && generation <= r.diedAt;
    }
}
