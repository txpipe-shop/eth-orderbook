import { network } from "hardhat";
import { formatEther, getContract, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Canonical WETH9 on Sepolia.
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const;

// Amount of ETH to wrap. Override with: WRAP_AMOUNT=0.25 npx hardhat run ...
const amountStr = process.env.WRAP_AMOUNT ?? "0.1";

function accountFromEnv(name: string) {
  const key = process.env[name];
  if (!key) {
    throw new Error(`Missing ${name} in .env`);
  }
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

// Which account receives the WETH (defaults to PK1).
const account = accountFromEnv(process.env.WRAP_ACCOUNT ?? "PK1");

const connection = await network.create();
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [walletClient] = await viem.getWalletClients();

const wethAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const weth = getContract({ address: WETH_ADDRESS, abi: wethAbi, client: { public: publicClient, wallet: walletClient } });

const amount = parseEther(amountStr);
console.log(`Wrapping ${amountStr} ETH -> WETH for ${account.address}`);

// Sends ETH to the WETH contract, which mints WETH 1:1 back to the sender.
const hash = await weth.write.deposit({ account, value: amount });
await publicClient.waitForTransactionReceipt({ hash });

const balance = await weth.read.balanceOf([account.address]);
console.log(`WETH balance: ${formatEther(balance)} WETH`);

await connection.close();
