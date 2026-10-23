import { network } from "hardhat";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("Orderbook", async function () {
  const { viem, networkHelpers } = await network.create();
  const [owner, alice, bob] = await viem.getWalletClients();

  // Deploy two mock tokens and the orderbook, mint and approve in one fixture.
  async function deployFixture() {
    const tokenA = await viem.deployContract("MockERC20", ["Token A", "TKA"]);
    const tokenB = await viem.deployContract("MockERC20", ["Token B", "TKB"]);
    const orderbook = await viem.deployContract("Orderbook");

    // Alice holds tokenA, Bob holds tokenB.
    await tokenA.write.mint([alice.account.address, 1000n]);
    await tokenB.write.mint([bob.account.address, 1000n]);

    // Both approve the orderbook to spend their tokens.
    await tokenA.write.approve([orderbook.address, 1000n], {
      account: alice.account,
    });
    await tokenB.write.approve([orderbook.address, 1000n], {
      account: bob.account,
    });

    return { tokenA, tokenB, orderbook };
  }

  it("creates an order and locks tokenA", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await orderbook.write.createOrder(
      [tokenA.address, tokenB.address, 100n, 150n, 0n],
      { account: alice.account },
    );

    const aliceBalance = await tokenA.read.balanceOf([alice.account.address]);
    const orderbookBalance = await tokenA.read.balanceOf([orderbook.address]);

    assert.equal(aliceBalance, 900n);
    assert.equal(orderbookBalance, 100n);
  });

  it("reverts when creator lacks balance", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await viem.assertions.revertWith(
      orderbook.write.createOrder(
        [tokenA.address, tokenB.address, 1001n, 150n, 0n],
        { account: alice.account },
      ),
      "[createOrder]: Do not have enough balance",
    );
  });

  it("resolves an order and swaps tokens", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await orderbook.write.createOrder(
      [tokenA.address, tokenB.address, 100n, 150n, 0n],
      { account: alice.account },
    );

    await orderbook.write.resolveOrder([0n, 100n], { account: bob.account });

    const aliceBalanceA = await tokenA.read.balanceOf([alice.account.address]);
    const aliceBalanceB = await tokenB.read.balanceOf([alice.account.address]);
    const bobBalanceA = await tokenA.read.balanceOf([bob.account.address]);
    const bobBalanceB = await tokenB.read.balanceOf([bob.account.address]);

    assert.equal(aliceBalanceA, 900n);
    assert.equal(aliceBalanceB, 150n);
    assert.equal(bobBalanceA, 100n);
    assert.equal(bobBalanceB, 850n);
  });

  it("cannot resolve own order", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    const latestBlockTimestamp = await networkHelpers.time.latest();
    await orderbook.write.createOrder(
      [
        tokenA.address,
        tokenB.address,
        100n,
        150n,
        BigInt(latestBlockTimestamp + 100),
      ],
      {
        account: alice.account,
      },
    );

    await viem.assertions.revertWith(
      orderbook.write.resolveOrder([0n, 50n], { account: alice.account }),
      "[resolveOrder]: Cannot resolve own order",
    );
  });

  it("cannot resolve an already completed order", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    const latestBlockTimestamp = await networkHelpers.time.latest();
    await orderbook.write.createOrder(
      [
        tokenA.address,
        tokenB.address,
        100n,
        150n,
        BigInt(latestBlockTimestamp + 100),
      ],
      { account: alice.account },
    );

    await orderbook.write.resolveOrder([0n, 100n], { account: bob.account });

    await viem.assertions.revertWith(
      orderbook.write.resolveOrder([0n, 100n], { account: bob.account }),
      "[resolveOrder]: Order is not active",
    );
  });

  it("cancels an order and returns tokenA", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await orderbook.write.createOrder(
      [tokenA.address, tokenB.address, 100n, 150n, 0n],
      { account: alice.account },
    );

    await orderbook.write.cancelOrder([0n], { account: alice.account });

    const aliceBalance = await tokenA.read.balanceOf([alice.account.address]);
    const orderbookBalance = await tokenA.read.balanceOf([orderbook.address]);

    assert.equal(aliceBalance, 1000n);
    assert.equal(orderbookBalance, 0n);
  });

  it("only the creator can cancel", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await orderbook.write.createOrder(
      [tokenA.address, tokenB.address, 100n, 150n, 0n],
      { account: alice.account },
    );

    await viem.assertions.revertWith(
      orderbook.write.cancelOrder([0n], { account: bob.account }),
      "[cancelOrder]: Only creator can cancel order",
    );
  });

  it("should expire an order after the deadline and return tokenA", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    const latestBlockTimestamp = await networkHelpers.time.latest();
    await orderbook.write.createOrder(
      [
        tokenA.address,
        tokenB.address,
        100n,
        150n,
        BigInt(latestBlockTimestamp + 10),
      ],
      { account: alice.account },
    );

    await networkHelpers.time.increase(20);
    await orderbook.write.expireOrder([0n], { account: alice.account });

    const aliceBalance = await tokenA.read.balanceOf([alice.account.address]);
    const orderbookBalance = await tokenA.read.balanceOf([orderbook.address]);

    assert.equal(aliceBalance, 1000n);
    assert.equal(orderbookBalance, 0n);
  });

  it("should not allow expiring an order before the deadline", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    const latestBlockTimestamp = await networkHelpers.time.latest();
    await orderbook.write.createOrder(
      [
        tokenA.address,
        tokenB.address,
        100n,
        150n,
        BigInt(latestBlockTimestamp + 100),
      ],
      { account: alice.account },
    );

    await viem.assertions.revertWith(
      orderbook.write.expireOrder([0n], { account: alice.account }),
      "[expireOrder]: Order has not yet expired",
    );
  });

  it("partially resolves an order and updates remainingA", async () => {
    const { tokenA, tokenB, orderbook } =
      await networkHelpers.loadFixture(deployFixture);

    await orderbook.write.createOrder(
      [tokenA.address, tokenB.address, 100n, 150n, 0n],
      { account: alice.account },
    );

    await orderbook.write.resolveOrder([0n, 50n], { account: bob.account });

    const order = await orderbook.read.orders([0n]);
    assert.equal(order[3], 50n);

    const aliceBalanceA = await tokenA.read.balanceOf([alice.account.address]);
    const aliceBalanceB = await tokenB.read.balanceOf([alice.account.address]);
    const bobBalanceA = await tokenA.read.balanceOf([bob.account.address]);
    const bobBalanceB = await tokenB.read.balanceOf([bob.account.address]);

    assert.equal(aliceBalanceA, 900n);
    assert.equal(aliceBalanceB, 75n);
    assert.equal(bobBalanceA, 50n);
    assert.equal(bobBalanceB, 925n);
  });
});
