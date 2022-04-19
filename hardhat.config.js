/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("@nomiclabs/hardhat-waffle")
module.exports = {
  solidity: "0.8.9",
  paths: {
    artifacts: "./artifacts",
    sources: "./Contracts",
    cache: "./cache",
    tests: "./test"
  },
};
