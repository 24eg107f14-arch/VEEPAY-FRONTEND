export const NETWORKS = {
  testnet: { name: 'BSC Testnet', chainId: 97, rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545/', explorer: 'https://testnet.bscscan.com', usdt: '' },
  mainnet: { name: 'BNB Smart Chain', chainId: 56, rpc: 'https://bsc-dataseed.binance.org/', explorer: 'https://bscscan.com', usdt: '0x55d398326f99059fF775485246999027B3197955' }
};

export const USDT_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function transfer(address,uint256) returns (bool)'];
