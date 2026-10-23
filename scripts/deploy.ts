import { network } from "hardhat";

const connection = await network.create();
const { viem } = connection;

console.log(`Deploying Orderbook to network "${connection.networkName}"...`);
const orderbook = await viem.deployContract("Orderbook");

console.log(`Orderbook deployed at: ${orderbook.address}`);

await connection.close();
