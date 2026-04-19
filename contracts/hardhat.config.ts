import { defineConfig } from 'hardhat/config'
import hardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers'
import hardhatNodeTestRunner from '@nomicfoundation/hardhat-node-test-runner'
import hardhatViem from '@nomicfoundation/hardhat-viem'
import hardhatViemAssertions from '@nomicfoundation/hardhat-viem-assertions'

export default defineConfig({
  plugins: [
    hardhatNetworkHelpers,
    hardhatNodeTestRunner,
    hardhatViem,
    hardhatViemAssertions,
  ],
  paths: {
    sources: './src',
    tests: '../tests/contracts',
  },
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
})
