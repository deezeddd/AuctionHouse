const { expect } = require("chai"); 

describe("AuctionHouseTest", function () {

  let NFT;
  let nft;
  let deployer;
  let devs;
  let AuctionHouse;
  let auctionHouse;
  let bidderA;
  let bidderB;
  let addr1;
  let addr2;
  let addrs;
  let WETH;
  let weth;
  const TIME_BUFFER = 15 * 60;
  const RESERVE_PRICE = 2;
  const MIN_INCREMENT_BID_PERCENTAGE = 5;
  const DURATION = 60 * 60 * 24;
  let URI = "sample URI"

  beforeEach(async function () {
    
    [deployer, devs,bidderA, bidderB, addr1, addr2, ...addrs] = await ethers.getSigners();
    
    NFT = await ethers.getContractFactory("NFT");
    nft = await NFT.deploy();
    
    WETH = await ethers.getContractFactory("WETH"); 
    weth = await WETH.deploy();

    AuctionHouse = await ethers.getContractFactory("AuctionHouse");
    auctionHouse = await AuctionHouse.deploy();   
    auctionHouse.initialize(await weth.address,devs.address,TIME_BUFFER,RESERVE_PRICE,MIN_INCREMENT_BID_PERCENTAGE,DURATION);   
  });
  
  describe("Deployment", function () {
    
    it("Should track name and symbol of the nft collection", async function () {
      // This test expects the owner variable stored in the contract to be equal
      // to our Signer's owner.
      const nftName = "Test NFT"
      const nftSymbol = "TST"
      expect(await nft.name()).to.equal(nftName);
      expect(await nft.symbol()).to.equal(nftSymbol);
      
    });
    
    it("Should track all initializing parameters in AuctionHouse ", async function () {
      expect(await auctionHouse.weth()).to.equal(weth.address);
      expect(await auctionHouse.devs()).to.equal(devs.address);
      expect(await auctionHouse.timeBuffer()).to.equal(TIME_BUFFER);
      expect(await auctionHouse.reservePrice()).to.equal(RESERVE_PRICE);
      expect(await auctionHouse.minBidIncrementPercentage()).to.equal(MIN_INCREMENT_BID_PERCENTAGE);
      expect(await auctionHouse.duration()).to.equal(DURATION);
    });

    it("Should revert if initializing is called twice", async function(){
      
      await expect(auctionHouse.initialize(await weth.address,devs.address,TIME_BUFFER,RESERVE_PRICE,MIN_INCREMENT_BID_PERCENTAGE,DURATION))
      .to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Minting NFTs", function () {
      
      it("Should track each minted NFT", async function () {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      expect(await nft.tokenCount()).to.equal(1);
      expect(await nft.balanceOf(addr1.address)).to.equal(1);
      expect(await nft.tokenURI(1)).to.equal(URI);
      // addr2 mints an nft
      await nft.connect(addr2).mint(URI)
      expect(await nft.tokenCount()).to.equal(2);
      expect(await nft.balanceOf(addr2.address)).to.equal(1);
      expect(await nft.tokenURI(2)).to.equal(URI);
    });
  })
  
  describe("Adding nft to basket.", function () {
    beforeEach(async function () {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves auctionHouse to spend nft
      await nft.connect(addr1).setApprovalForAll(auctionHouse.address, true)
      // addr1 adds their nft to basket
    })
    
    it("Should track added token, transfer NFT from seller to AuctionHouse and emit AddedToBasket event", async function () {
      
      await expect(auctionHouse.connect(addr1).addToBasket(nft.address, 1))
      .to.emit(auctionHouse, "AddedToBasket")
      .withArgs(
        1,
        addr1.address,
        nft.address,
        1
        )
      // Owner of NFT should now be the auctionHouse
      expect(await nft.ownerOf(1)).to.equal(auctionHouse.address);
    });
    
  })
  describe("Retrieving nft from basket.", function () {
    beforeEach(async function () {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves auctionHouse to spend nft
      await nft.connect(addr1).setApprovalForAll(auctionHouse.address, true)
      // addr1 adds their nft to basket
      await expect(auctionHouse.connect(addr1).addToBasket(nft.address, 1))
    })
    
    it("Should revert if the token is asked to be returned by other address", async function () {
        await expect(auctionHouse.connect(addr2).retrieve(1)).to.be.revertedWith("Only author can retrieve NFT.");
      });
    
      it("Should return nft to owner if all conditions are met", async function () {
        await auctionHouse.connect(addr1).retrieve(1);
        expect(await nft.ownerOf(1)).to.equal(addr1.address);
      });
      
    })
    
    describe("Creating an Auction", async function (){
    beforeEach(async function () {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves auctionHouse to spend nft
      await nft.connect(addr1).setApprovalForAll(auctionHouse.address, true)
      // addr1 adds their nft to basket
      await auctionHouse.connect(addr1).addToBasket(nft.address, 1);
    })
    
    it("Should select a token using selection function and emit the selected basketID", async function () {  
      expect(await auctionHouse.createNewAuction()).to.emit(auctionHouse, "SentToAuction")
      .withArgs(1)
    });

    it("Should revert if a token is asked to be returned while in Auction", async function () {
      await auctionHouse.createNewAuction();
      await expect(auctionHouse.connect(addr1).retrieve(1)).to.be.revertedWith("NFT is in Auction House.");
    }); 

    it("Should create auction for a token called by getToken ", async function () {
      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const timestamp = blockBefore.timestamp + 1;
      await expect(auctionHouse.createNewAuction()).to.emit(auctionHouse, "AuctionCreated")
      .withArgs(1,timestamp,timestamp + DURATION,1);
      const auction = await auctionHouse.auction();
      expect(auction.basketID).to.equal(1)
      expect(auction.amount).to.equal(0)
      expect(auction.startTime).to.equal(timestamp)
      expect(auction.endTime).to.equal(timestamp + DURATION)
      expect(auction.settled).to.equal(false)
    });

    it("Should revert if no nft is left in basket", async function (){
        await auctionHouse.connect(addr1).retrieve(1);
        await expect(auctionHouse.createNewAuction()).to.be.revertedWith("All tokens either retrieved or sold!");
      })
  })

    describe("Get token function fails", async function (){
        it("Should revert if createAuction is called before collecting any nft", async function (){
            await expect(auctionHouse.createNewAuction()).to.be.revertedWith("No token in basket!");
          })
      })
      
  describe("Creating a bid", async function (){
    beforeEach(async function(){
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves auctionHouse to spend nft
      await nft.connect(addr1).setApprovalForAll(auctionHouse.address, true)
      // addr1 adds their nft to basket
      await auctionHouse.connect(addr1).addToBasket(nft.address, 1);
      await auctionHouse.createNewAuction();
      
    })
    
    it("Should revert if a user creates a bid for an inactive auction", async function (){
      await expect(auctionHouse.connect(bidderA).createBid(2)).to.be.revertedWith("NFT not up for auction");
    })
    
    it("Should revert if a user creates a bid for an expired auction", async function (){
      await ethers.provider.send('evm_increaseTime', [60 * 60 * 25]); // Add 25 hours
      await expect(auctionHouse.connect(bidderA).createBid(1)).to.be.revertedWith("Auction expired");
    })
    
    it("Should revert if a user creates a bid with an amount below the reserve price", async function (){
      await expect(auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE - 1}))
      .to.be.revertedWith("Must send at least reservePrice");
    })
    
    it("Should revert if a user creates a bid less than the min bid increment percentage", async function (){
      // create bid of 100
      await auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE * 50});
      // create bid of 104 which has increment of only 4% 
      await expect(auctionHouse.connect(bidderB).createBid(1, {value: RESERVE_PRICE * 52}))
      .to.be.revertedWith("Must send more than last bid by minBidIncrementPercentage amount");
    })
    
    it("Should refund the previous bidder when the following user creates a bid", async function (){
      await auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE });
      const prevBalance = await bidderA.getBalance();
      await auctionHouse.connect(bidderB).createBid(1, {value: RESERVE_PRICE*2 });
      const currBalance = await bidderA.getBalance();
      expect(currBalance).to.equal(prevBalance.add(RESERVE_PRICE));
    })
    
    it("Should emit an `AuctionBid` event on a successful bid",async function (){
      await expect(auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE }))
      .to.emit(auctionHouse, 'AuctionBid')
      .withArgs(1, bidderA.address, RESERVE_PRICE, false);
    })
    
    it("Should emit an `AuctionExtended` event if the auction end time is within the time buffer",async function (){
      // Subtract 5 mins from current end time
      const auction = await auctionHouse.auction();
      const endTime = auction.endTime;
      await ethers.provider.send('evm_setNextBlockTimestamp', [endTime.sub(60 * 5).toNumber()]);
      await expect(auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE }))
      .to.emit(auctionHouse, 'AuctionExtended')
      .withArgs(1, endTime.add(60 * 10));
    })

  })
  
  describe("Settlement of an auction", async function (){
    beforeEach(async function(){
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves auctionHouse to spend nft
      await nft.connect(addr1).setApprovalForAll(auctionHouse.address, true)
      // addr1 adds their nft to basket
      await auctionHouse.connect(addr1).addToBasket(nft.address, 1);
      await auctionHouse.createNewAuction();
      
    })
    
    it("Should revert if auction settlement is attempted while the auction is still active",async function (){
      await auctionHouse.connect(bidderA).createBid(1, {value: RESERVE_PRICE });
      await expect(auctionHouse.settleAuction())
      .to.be.revertedWith("Auction hasn't completed");
    })
    
    it("Should send token to author if no one bids",async function (){
      
      await ethers.provider.send('evm_increaseTime', [60 * 60 * 25]); // Add 25 hours
      await auctionHouse.settleAuction();
      // Owner of NFT should now be the author again
      expect(await nft.ownerOf(1)).to.equal(addr1.address);
    })
    
    it("Should send 10% to devs and 90% to author",async function (){
      await auctionHouse.connect(bidderA).createBid(1, {value: 100 });
      await ethers.provider.send('evm_increaseTime', [60 * 60 * 25]); // Add 25 hours
      const prevBalance1 = await devs.getBalance();
      const prevBalance2 = await addr1.getBalance();
      await auctionHouse.settleAuction();
      const currBalance1 = await devs.getBalance();
      const currBalance2 = await addr1.getBalance();
      expect(currBalance1).to.equal(prevBalance1.add(10));
      expect(currBalance2).to.equal(prevBalance2.add(90));
    })
  })
  });