# Important Notes

## Reentrancy

Initialy, the `resolveOrder` function was:

```sol
function resolveOrder(uint id) external {
    require(id < nextOrderId, "[resolveOrder]: Order does not exist");

    Order storage order = orders[id];
    require(order.status == OrderStatus.Active, "[resolveOrder]: Order is not active");
    require(order.creator != msg.sender, "[resolveOrder]: Cannot resolve own order");

    uint tokenBBalance = IERC20(order.tokenB).balanceOf(msg.sender);
    require(tokenBBalance >= order.amountB, "[resolveOrder]: Do not have enough balance");

    bool s1 = IERC20(order.tokenB).transferFrom(msg.sender, order.creator, order.amountB);
    require(s1, "[resolveOrder]: Error transfering tokenB to creator");
    bool s2 = IERC20(order.tokenA).transfer(msg.sender, order.amountA);
    require(s2, "[resolveOrder]: Error transfering tokenA to resolver");

    order.status = OrderStatus.Completed;
    emit ResolveOrder(id, msg.sender, order.tokenA, order.tokenB, order.amountA, order.amountB);
  }
```

This function has a vulnerability. A malicious token contract could call back into the `resolveOrder` function during the `transferFrom` or `transfer` calls, potentially allowing them to manipulate the order state or perform other unintended actions.
To mitigate this risk, the order status is updated to `Completed` before the token transfers are executed. This change ensures that even if a reentrant call is made, the order will already be marked as completed, preventing any further actions on it.
If the transfer fails, the function will revert, and the order status will remain `Completed`, which is a safer state than leaving it as `Active`. This approach helps to prevent reentrancy attacks and ensures the integrity of the order state.
Another approach is to use `ReentrancyGuard` from OpenZeppelin, which provides a modifier to prevent reentrant calls to a function.

## ERC20 vs SafeERC20

Initially, the contract uses the `IERC20` interface to interact with ERC20 tokens. However, this approach has some risks. The `transfer` and `transferFrom` functions of ERC20 tokens return a boolean value indicating success or failure. If a token contract does not adhere to the ERC20 standard and does not return a value, the call will succeed even if the transfer fails, leading to potential loss of funds or unexpected behavior.

The code was:

```sol
bool s1 = IERC20(order.tokenB).transferFrom(msg.sender, order.creator, order.amountB);
require(s1, "[resolveOrder]: Error transfering tokenB to creator");
bool s2 = IERC20(order.tokenA).transfer(msg.sender, order.amountA);
require(s2, "[resolveOrder]: Error transfering tokenA to resolver");
```

When working with ERC20 tokens, it's important to use the `SafeERC20` library from OpenZeppelin. This library provides a safer way to interact with ERC20 tokens by automatically checking the return value of transfer functions and reverting if the transfer fails. This helps to prevent issues where a token contract might not behave as expected, leading to unexpected state changes or loss of funds.

## Require vs Revert with custom errors

When we use `require` statements with custom error messages, we can provide more context about why a transaction failed. However, using custom errors (introduced in Solidity 0.8.4) is more gas-efficient than using `require` with strings, as it allows us to define specific error types that can be caught and handled by the calling contract or frontend.
