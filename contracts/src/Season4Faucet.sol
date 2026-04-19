// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract Season4Faucet {
    IERC20Like public immutable collateralToken;
    address public owner;
    uint256 public claimAmount;
    uint256 public claimCooldownSeconds;

    mapping(address => uint256) public lastClaimedAt;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FaucetClaimed(address indexed recipient, uint256 amount);
    event ClaimAmountUpdated(uint256 nextAmount);
    event ClaimCooldownUpdated(uint256 nextCooldownSeconds);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    constructor(address collateralTokenAddress, uint256 initialClaimAmount, uint256 initialCooldownSeconds) {
        require(collateralTokenAddress != address(0), "ZERO_TOKEN");
        collateralToken = IERC20Like(collateralTokenAddress);
        owner = msg.sender;
        claimAmount = initialClaimAmount;
        claimCooldownSeconds = initialCooldownSeconds;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setClaimAmount(uint256 nextAmount) external onlyOwner {
        claimAmount = nextAmount;
        emit ClaimAmountUpdated(nextAmount);
    }

    function setClaimCooldownSeconds(uint256 nextCooldownSeconds) external onlyOwner {
        claimCooldownSeconds = nextCooldownSeconds;
        emit ClaimCooldownUpdated(nextCooldownSeconds);
    }

    function canClaim(address recipient) public view returns (bool) {
        uint256 lastClaim = lastClaimedAt[recipient];
        return lastClaim == 0 || block.timestamp >= lastClaim + claimCooldownSeconds;
    }

    function claim() external {
        _claimTo(msg.sender);
    }

    function claimTo(address recipient) external onlyOwner {
        _claimTo(recipient);
    }

    function _claimTo(address recipient) internal {
        require(recipient != address(0), "ZERO_RECIPIENT");
        require(canClaim(recipient), "CLAIM_COOLDOWN");
        lastClaimedAt[recipient] = block.timestamp;
        require(collateralToken.transfer(recipient, claimAmount), "TOKEN_TRANSFER_FAILED");
        emit FaucetClaimed(recipient, claimAmount);
    }
}
