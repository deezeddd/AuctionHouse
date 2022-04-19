// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import './IWETH.sol';
import { IERC721 } from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import { PausableUpgradeable } from '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import { ReentrancyGuardUpgradeable } from '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import { OwnableUpgradeable } from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import "hardhat/console.sol";
contract AuctionHouse is PausableUpgradeable, ReentrancyGuardUpgradeable, OwnableUpgradeable{
    
     // status of token
    enum basketStatus {
		InAuction,
		InBasket,
        Returned,
		Sold
	}

    // stores all relevant data of token
    struct Token {
        basketStatus status;
        address author;
        address tokenAddy;
        uint256 tokenID;
    }

    struct Auction {
        // Basket ID for the ERC721 token
        uint256 basketID;
        // The current highest bid amount
        uint256 amount;
        // The time that the auction started
        uint256 startTime;
        // The time that the auction is scheduled to end
        uint256 endTime;
        // The address of the current highest bid
        address payable bidder;
        // Whether or not the auction has been settled
        bool settled;
    }

    // Map that stores all info about token
    mapping (uint256 =>Token) private _basket;
    
    // Stores total tokens recieved till date
    uint256 _basketID=0;

    // The address of the WETH contract
    address public weth;

    // The address of developers who get 10% value from each sale
    address public devs;

    // The minimum amount of time left in an auction after a new bid is created
    uint256 public timeBuffer;

    // The minimum price accepted in an auction
    uint256 public reservePrice;

    // The minimum percentage difference between the last bid amount and the current bid
    uint8 public minBidIncrementPercentage;

    // The duration of a single auction
    uint256 public duration;

    // The number of the current auction
    uint256 public auctionNumber = 0;

    // The active auction
    Auction public auction;

    event AddedToBasket(
		uint256 basketID,
		address author,
        address tokenAddy,
        uint256 tokenID
	);

    event noBidders(
        uint basketID,
        address author
    );

    event Retrieved(
		uint256 basketID,
		address author
	);

    event SentToAuction(
        uint256 basketID
    );

    event AuctionCreated(uint256 indexed basketID, uint256 startTime, uint256 endTime, uint256 auctionNumber);

    event AuctionBid(uint256 indexed basketID, address sender, uint256 value, bool extended);

    event AuctionExtended(uint256 indexed basketID, uint256 endTime);

    event AuctionSettled(uint256 indexed basketID, address winner, uint256 amount);

    event AuctionTimeBufferUpdated(uint256 timeBuffer);

    event AuctionReservePriceUpdated(uint256 reservePrice);

    event AuctionMinBidIncrementPercentageUpdated(uint256 minBidIncrementPercentage);

    /**
     * @notice Initialize the auction house and base contracts,
     * populate configuration values, and pause the contract.
     * @dev This function can only be called once.
     */
    function initialize(
        address _weth,
        address payable _devs,
        uint256 _timeBuffer,
        uint256 _reservePrice,
        uint8 _minBidIncrementPercentage,
        uint256 _duration
    ) external initializer {
        __Pausable_init();
        __ReentrancyGuard_init();
        __Ownable_init();

        // _pause();

        weth = _weth;
        devs = _devs;
        timeBuffer = _timeBuffer;
        reservePrice = _reservePrice;
        minBidIncrementPercentage = _minBidIncrementPercentage;
        duration = _duration;
    }   

    /** 
    * @notice adding a token to the basket of nfts.
    */
    function addToBasket (address tokenAddy, uint256 tokenID) public
    {
        IERC721(tokenAddy).transferFrom(msg.sender, address(this), tokenID);

        Token memory item = Token(
            basketStatus.InBasket,
            msg.sender,
            tokenAddy,
            tokenID
        );

        _basketID++;
        _basket[_basketID]= item;

        emit AddedToBasket(
            _basketID,
            msg.sender,
            tokenAddy,
            tokenID
        );
    }

    /** 
    * @notice change state of token to InAuction and return basketID and token info
    * @dev is called by the createAuction function
    */
    function getToken() private returns(uint256)
    {
        require(_basketID > 0, "No token in basket!");
        uint256 selectedID;
        for(uint i=0;i<_basketID;i++){
            selectedID = selection();
            if(_basket[selectedID].status == basketStatus.InBasket)
            break;
        }
        require(_basket[selectedID].status == basketStatus.InBasket, "All tokens either retrieved or sold!");
        _basket[selectedID].status = basketStatus.InAuction;

        emit SentToAuction(selectedID);

        return (selectedID);
    }

    /**
    * @notice return token to author
    * @dev only works if token is available in basket
    */      
    function retrieve(uint256 id) public {
        Token memory returnToken = _basket[id];
        require(msg.sender == returnToken.author, "Only author can retrieve NFT.");
        require(returnToken.status!= basketStatus.InAuction, "NFT is in Auction House.");
        require(returnToken.status!= basketStatus.Returned, "NFT has already been returned.");
        require(returnToken.status!= basketStatus.Sold, "NFT has been sold.");

        IERC721(returnToken.tokenAddy).transferFrom(address(this), msg.sender, returnToken.tokenID);
        _basket[id].status = basketStatus.Returned;
        emit Retrieved(
            id,
            msg.sender
        );
    }

    /**
    * @notice contains the criteria on the basis of which a token is selected
    * @dev this function currently returns a random basketID
    */
    function selection() internal view returns(uint256){
        uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender, block.difficulty)));
        random= (random % _basketID) + 1;
        return random;
    }



    /**
     * @notice Create a new auction by selecting an nft from basket
     * @dev it will be called to start the first auction. After that,
     * new auction will only start if previous auction has ended.
     */
    function createNewAuction() external   nonReentrant whenNotPaused {
        if(auctionNumber>0){
            require(auction.settled, 'Previous auction has not been settled');
        }
        _createAuction();
    }
    
    /**
     * @notice Create an auction.
     * @dev Store the auction details in the `auction` state variable and emit an AuctionCreated event.
     * If the selection process fails or nft is not sent. Catch the revert and pause this contract.
     */
    function _createAuction() internal {

            uint256 basketID = getToken();
            uint256 startTime = block.timestamp;
            uint256 endTime = startTime + duration;

            auction = Auction({
                basketID: basketID,
                amount: 0,
                startTime: startTime,
                endTime: endTime,
                bidder: payable(0),
                settled: false
            });
            auctionNumber++;
            emit AuctionCreated(auction.basketID, startTime, endTime, auctionNumber);
    }

    /**
     * @notice Create a bid for a token, with a given amount.
     * @dev This contract only accepts payment in ETH.
     */
    function createBid(uint256 basketID) external payable   nonReentrant {
        Auction memory _auction = auction;

        require(_auction.basketID ==basketID , 'NFT not up for auction');
        require(block.timestamp < _auction.endTime, 'Auction expired');
        require(msg.value >= reservePrice, 'Must send at least reservePrice');
        require(
            msg.value >= _auction.amount + ((_auction.amount * minBidIncrementPercentage) / 100),
            'Must send more than last bid by minBidIncrementPercentage amount'
        );

        address payable lastBidder = _auction.bidder;

        // Refund the last bidder, if applicable
        if (lastBidder != address(0)) {
            _safeTransferETHWithFallback(lastBidder, _auction.amount);
        }

        auction.amount = msg.value;
        auction.bidder = payable(msg.sender);

        // Extend the auction if the bid was received within `timeBuffer` of the auction end time
        bool extended = _auction.endTime - block.timestamp < timeBuffer;
        if (extended) {
            auction.endTime = _auction.endTime = block.timestamp + timeBuffer;
        }

        emit AuctionBid(_auction.basketID, msg.sender, msg.value, extended);

        if (extended) {
            emit AuctionExtended(_auction.basketID, _auction.endTime);
        }
    }

    /**
     * @notice Settle the current auction.
     */
    function settleAuction() external   nonReentrant {
        _settleAuction();
    }

    /**
     * @notice Settle an auction, finalizing the bid and paying out to the owner and devs.
     * @dev If there are no bids, the token is sent back to its author.
     */
    function _settleAuction() internal {
        Auction memory _auction = auction;
        Token memory _nft = _basket[_auction.basketID];
        require(_auction.startTime != 0, "Auction hasn't begun");
        require(!_auction.settled, 'Auction has already been settled');
        require(block.timestamp >= _auction.endTime, "Auction hasn't completed");

        auction.settled = true;

        // if nobody placed a bid in auction, return nft to author
        if (_auction.bidder == address(0)) {
            IERC721(_nft.tokenAddy).transferFrom(address(this), _nft.author, _nft.tokenID);
            _basket[_auction.basketID].status = basketStatus.Returned;
            emit noBidders(
            _auction.basketID,
            _nft.author
        );
        } 

        // else send nft to bidder who won auction
        else {
            IERC721(_nft.tokenAddy).transferFrom(address(this), _auction.bidder, _nft.tokenID);
            _nft.status = basketStatus.Sold;
        }

        // send 90% amount to author of nft and 10% share to devs 
        if (_auction.amount > 0) {
            uint256 devsShare = (_auction.amount)/10;
            uint256 authorShare =  _auction.amount - devsShare;
            _safeTransferETHWithFallback(payable (devs), devsShare);
            _safeTransferETHWithFallback(_nft.author, authorShare);

        }

        emit AuctionSettled(_auction.basketID, _auction.bidder, _auction.amount);
    }

    /**
     * @notice Pause the auction house.
     * @dev This function can only be called by the owner when the
     * contract is unpaused. While no new auctions can be started when paused,
     * anyone can settle an ongoing auction.
     */
    function pause() external   onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the auction house.
     * @dev This function can only be called by the owner when the
     * contract is paused. If required, this function will start a new auction.
     */
    function unpause() external   onlyOwner {
        _unpause();

        if (auction.startTime == 0 || auction.settled) {
            _createAuction();
        }
    }

    /**
     * @notice Set the auction time buffer.
     * @dev Only callable by the owner.
     */
    function setTimeBuffer(uint256 _timeBuffer) external   onlyOwner {
        timeBuffer = _timeBuffer;

        emit AuctionTimeBufferUpdated(_timeBuffer);
    }

    /**
     * @notice Set the auction reserve price.
     * @dev Only callable by the owner.
     */
    function setReservePrice(uint256 _reservePrice) external   onlyOwner {
        reservePrice = _reservePrice;

        emit AuctionReservePriceUpdated(_reservePrice);
    }

    /**
     * @notice Set the auction minimum bid increment percentage.
     * @dev Only callable by the owner.
     */
    function setMinBidIncrementPercentage(uint8 _minBidIncrementPercentage) external   onlyOwner {
        minBidIncrementPercentage = _minBidIncrementPercentage;

        emit AuctionMinBidIncrementPercentageUpdated(_minBidIncrementPercentage);
    }

    /**
     * @notice Transfer ETH. If the ETH transfer fails, wrap the ETH and try send it as WETH.
     */
    function _safeTransferETHWithFallback(address to, uint256 amount) internal {
        if (!_safeTransferETH(to, amount)) {
            IWETH(weth).deposit{ value: amount }();
            IERC20(weth).transfer(to, amount);
        }
    }

    /**
     * @notice Transfer ETH and return the success status.
     * @dev This function only forwards 30,000 gas to the callee.
     */
    function _safeTransferETH(address to, uint256 value) internal returns (bool) {
        (bool success, ) = to.call{ value: value, gas: 30_000 }(new bytes(0));
        return success;
    }

}