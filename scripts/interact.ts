import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { network } from "hardhat";
import { formatUnits, getAddress, getContract, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---- Accounts from .env ----
function accountFromEnv(name: string) {
  const key = process.env[name];
  if (!key) {
    throw new Error(`Missing ${name} in .env`);
  }
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

const creator = accountFromEnv("PK1"); // locks tokenA
const resolver = accountFromEnv("PK2"); // pays tokenB

// ---- Ask for the addresses / amounts ----
const rl = createInterface({ input, output });
const orderbookAddress = getAddress((await rl.question("Orderbook address: ")).trim());
const tokenAAddress = getAddress((await rl.question("Token A address (creator locks this): ")).trim());
const tokenBAddress = getAddress((await rl.question("Token B address (resolver pays this): ")).trim());
const amountAStr = (await rl.question("Amount A (human units): ")).trim();
const amountBStr = (await rl.question("Amount B (human units): ")).trim();
rl.close();

// ---- Connect to the network ----
const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [walletClient] = await viem.getWalletClients();

const orderbook = await viem.getContractAt("Orderbook", orderbookAddress);

// Minimal ERC20 interface — works for any standard token (USDC, DAI, MockERC20...).
const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const tokenA = getContract({ address: tokenAAddress, abi: erc20Abi, client: { public: publicClient, wallet: walletClient } });
const tokenB = getContract({ address: tokenBAddress, abi: erc20Abi, client: { public: publicClient, wallet: walletClient } });

const decimalsA = await tokenA.read.decimals();
const decimalsB = await tokenB.read.decimals();
const amountA = parseUnits(amountAStr, decimalsA);
const amountB = parseUnits(amountBStr, decimalsB);

console.log(`\nCreator:  ${creator.address}`);
console.log(`Resolver: ${resolver.address}`);
console.log(`tokenA: ${tokenAAddress} (amount ${amountA})`);
console.log(`tokenB: ${tokenBAddress} (amount ${amountB})`);

// ---- Pre-checks ----
const balA = await tokenA.read.balanceOf([creator.address]);
const balB = await tokenB.read.balanceOf([resolver.address]);
if (balA < amountA) {
  throw new Error(`Creator needs ${amountAStr} tokenA but has ${formatUnits(balA, decimalsA)}`);
}
if (balB < amountB) {
  throw new Error(`Resolver needs ${amountBStr} tokenB but has ${formatUnits(balB, decimalsB)}`);
}

// The order id the upcoming createOrder call will use.
const orderId = await orderbook.read.nextOrderId();

// ---- 1. Creator approves tokenA to the Orderbook ----
const approveA = await tokenA.write.approve([orderbookAddress, amountA], { account: creator });
await publicClient.waitForTransactionReceipt({ hash: approveA });
console.log(`Approved tokenA for creator (${approveA})`);

// ---- 2. Creator creates the order ----
const createHash = await orderbook.write.createOrder(
  [tokenAAddress, tokenBAddress, amountA, amountB, 0n],
  { account: creator },
);
await publicClient.waitForTransactionReceipt({ hash: createHash });
console.log(`Order #${orderId} created (${createHash})`);

// ---- 3. Resolver approves tokenB to the Orderbook ----
const approveB = await tokenB.write.approve([orderbookAddress, amountB], { account: resolver });
await publicClient.waitForTransactionReceipt({ hash: approveB });
console.log(`Approved tokenB for resolver (${approveB})`);

// ---- 4. Resolver fully fills the order ----
const resolveHash = await orderbook.write.resolveOrder([orderId, amountA], { account: resolver });
await publicClient.waitForTransactionReceipt({ hash: resolveHash });
console.log(`Order #${orderId} resolved (${resolveHash})`);

// ---- Result ----
const order = await orderbook.read.orders([orderId]);
const [, , , remainingA] = order;
const status = order[6];
const statusName = ["Active", "Completed", "Cancelled", "Expired"][status];
console.log(`\nOrder #${orderId}: status=${statusName}, remainingA=${remainingA}`);

await connection.close();
