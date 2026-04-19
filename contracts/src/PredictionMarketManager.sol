// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Collateral {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PredictionMarketManager {
    uint256 private constant ONE = 1e18;

    enum MarketStatus {
        Draft,
        Open,
        Closed,
        Resolved
    }

    struct Market {
        address collateralToken;
        string metadataUri;
        uint64 closeTime;
        uint256 liquidityB;
        uint256 qYes;
        uint256 qNo;
        MarketStatus status;
        bool resolvedOutcomeYes;
        bool exists;
    }

    address public owner;
    uint256 public nextMarketId = 1;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesBalances;
    mapping(uint256 => mapping(address => uint256)) public noBalances;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketCreated(
        uint256 indexed marketId,
        string metadataUri,
        uint64 closeTime,
        address collateralToken,
        uint256 liquidityB
    );
    event TradeExecuted(
        uint256 indexed marketId,
        address indexed trader,
        bool isBuy,
        bool isYes,
        uint256 collateralAmount,
        uint256 shareDelta,
        uint256 priceYesE18
    );
    event MarketResolved(uint256 indexed marketId, bool outcomeYes);
    event WinningsRedeemed(uint256 indexed marketId, address indexed trader, uint256 collateralAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    modifier onlyOpenMarket(uint256 marketId) {
        Market storage market = markets[marketId];
        require(market.exists, "UNKNOWN_MARKET");
        require(market.status == MarketStatus.Open, "MARKET_NOT_OPEN");
        require(block.timestamp < market.closeTime, "MARKET_CLOSED");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function createMarket(
        address collateralToken,
        string calldata metadataUri,
        uint64 closeTime,
        uint256 liquidityB,
        uint256 initialPriceYesE18
    ) external onlyOwner returns (uint256 marketId) {
        require(collateralToken != address(0), "ZERO_TOKEN");
        require(closeTime > block.timestamp, "INVALID_CLOSE_TIME");
        require(liquidityB > 0, "INVALID_LIQUIDITY");
        require(initialPriceYesE18 > 0 && initialPriceYesE18 < ONE, "INVALID_INITIAL_PRICE");

        (uint256 initialQYes, uint256 initialQNo) = _initialVirtualBalances(liquidityB, initialPriceYesE18);

        marketId = nextMarketId++;
        markets[marketId] = Market({
            collateralToken: collateralToken,
            metadataUri: metadataUri,
            closeTime: closeTime,
            liquidityB: liquidityB,
            qYes: initialQYes,
            qNo: initialQNo,
            status: MarketStatus.Open,
            resolvedOutcomeYes: false,
            exists: true
        });

        emit MarketCreated(marketId, metadataUri, closeTime, collateralToken, liquidityB);
    }

    function _initialVirtualBalances(
        uint256 liquidityB,
        uint256 initialPriceYesE18
    ) private pure returns (uint256 initialQYes, uint256 initialQNo) {
        if (initialPriceYesE18 == 5e17) {
            return (0, 0);
        }

        if (initialPriceYesE18 > 5e17) {
            return (
                (liquidityB * ((2 * initialPriceYesE18) - ONE)) / (ONE - initialPriceYesE18),
                0
            );
        }

        return (
            0,
            (liquidityB * (ONE - (2 * initialPriceYesE18))) / initialPriceYesE18
        );
    }

    function priceYesE18(uint256 marketId) public view returns (uint256) {
        Market storage market = markets[marketId];
        require(market.exists, "UNKNOWN_MARKET");

        uint256 numerator = market.qYes + market.liquidityB;
        uint256 denominator = market.qYes + market.qNo + (2 * market.liquidityB);
        if (denominator == 0) {
            return 5e17;
        }

        return (numerator * 1e18) / denominator;
    }

    function priceNoE18(uint256 marketId) public view returns (uint256) {
        return 1e18 - priceYesE18(marketId);
    }

    // This Base Sepolia v1 draft keeps qYes/qNo/liquidityB onchain and emits
    // deterministic trade events for the app indexer. Before any real-money use,
    // replace the marginal-price quote path below with a fully audited LMSR integral.
    function buyYes(uint256 marketId, uint256 collateralAmount, uint256 minSharesOut) external onlyOpenMarket(marketId) {
        _trade(marketId, collateralAmount, minSharesOut, true, true);
    }

    function buyNo(uint256 marketId, uint256 collateralAmount, uint256 minSharesOut) external onlyOpenMarket(marketId) {
        _trade(marketId, collateralAmount, minSharesOut, true, false);
    }

    function sellYes(uint256 marketId, uint256 shareAmount, uint256 minCollateralOut) external onlyOpenMarket(marketId) {
        _trade(marketId, shareAmount, minCollateralOut, false, true);
    }

    function sellNo(uint256 marketId, uint256 shareAmount, uint256 minCollateralOut) external onlyOpenMarket(marketId) {
        _trade(marketId, shareAmount, minCollateralOut, false, false);
    }

    function closeMarket(uint256 marketId) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.exists, "UNKNOWN_MARKET");
        require(market.status == MarketStatus.Open, "MARKET_NOT_OPEN");
        market.status = MarketStatus.Closed;
    }

    function resolveMarket(uint256 marketId, bool outcomeYes) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.exists, "UNKNOWN_MARKET");
        require(market.status == MarketStatus.Open || market.status == MarketStatus.Closed, "INVALID_STATUS");
        market.status = MarketStatus.Resolved;
        market.resolvedOutcomeYes = outcomeYes;
        emit MarketResolved(marketId, outcomeYes);
    }

    function redeemWinnings(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.exists, "UNKNOWN_MARKET");
        require(market.status == MarketStatus.Resolved, "MARKET_NOT_RESOLVED");

        uint256 winningShares = market.resolvedOutcomeYes
            ? yesBalances[marketId][msg.sender]
            : noBalances[marketId][msg.sender];
        require(winningShares > 0, "NO_WINNING_SHARES");

        yesBalances[marketId][msg.sender] = 0;
        noBalances[marketId][msg.sender] = 0;

        require(IERC20Collateral(market.collateralToken).transfer(msg.sender, winningShares), "TOKEN_TRANSFER_FAILED");
        emit WinningsRedeemed(marketId, msg.sender, winningShares);
    }

    function _trade(
        uint256 marketId,
        uint256 amount,
        uint256 limit,
        bool isBuy,
        bool isYes
    ) internal {
        require(amount > 0, "INVALID_AMOUNT");

        Market storage market = markets[marketId];
        uint256 currentPriceYes = priceYesE18(marketId);
        uint256 sidePrice = isYes ? currentPriceYes : (1e18 - currentPriceYes);
        require(sidePrice > 0, "INVALID_PRICE");

        if (isBuy) {
            uint256 shareDelta = (amount * 1e18) / sidePrice;
            require(shareDelta >= limit, "SLIPPAGE");
            require(
                IERC20Collateral(market.collateralToken).transferFrom(msg.sender, address(this), amount),
                "TOKEN_TRANSFER_FAILED"
            );

            if (isYes) {
                yesBalances[marketId][msg.sender] += shareDelta;
                market.qYes += shareDelta;
            } else {
                noBalances[marketId][msg.sender] += shareDelta;
                market.qNo += shareDelta;
            }

            emit TradeExecuted(marketId, msg.sender, true, isYes, amount, shareDelta, currentPriceYes);
            return;
        }

        uint256 collateralOut = (amount * sidePrice) / 1e18;
        require(collateralOut >= limit, "SLIPPAGE");

        if (isYes) {
            require(yesBalances[marketId][msg.sender] >= amount, "INSUFFICIENT_SHARES");
            yesBalances[marketId][msg.sender] -= amount;
            market.qYes -= amount;
        } else {
            require(noBalances[marketId][msg.sender] >= amount, "INSUFFICIENT_SHARES");
            noBalances[marketId][msg.sender] -= amount;
            market.qNo -= amount;
        }

        require(IERC20Collateral(market.collateralToken).transfer(msg.sender, collateralOut), "TOKEN_TRANSFER_FAILED");
        emit TradeExecuted(marketId, msg.sender, false, isYes, collateralOut, amount, currentPriceYes);
    }
}
