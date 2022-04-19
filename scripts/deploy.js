async function main() {
    const [deployer] = await ethers.getSigners();
  
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
    
    // Get the ContractFactories and Signers here.
    const NFT = await ethers.getContractFactory("NFT");
    const nft = await NFT.deploy();
    const AuctionHouse = await ethers.getContractFactory("AuctionHouse");
    const auctionHouse = await AuctionHouse.deploy();
    // deploy contracts
  }