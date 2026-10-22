// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Orderbook {
  using SafeERC20 for IERC20;

  enum OrderStatus { Active, Completed, Cancelled }

  struct Order {
    address creator;
    address tokenA;
    uint amountA;
    address tokenB;
    uint amountB;
    OrderStatus status;
  }

  mapping(uint => Order) public orders;
  uint nextOrderId = 0;

  event CreateOrder(uint id, address creator, address tokenA, address tokenB, uint amountA, uint amountB);
  event ResolveOrder(uint id, address resolver, address tokenA, address tokenB, uint amountA, uint amountB);
  event CancelOrder(uint id, address tokenA, address tokenB, uint amountA, uint amountB);

  function createOrder(
    address tokenA, address tokenB, uint amountA, uint amountB
  ) external {
    uint tokenABalance = IERC20(tokenA).balanceOf(msg.sender);
    require(tokenABalance >= amountA, "[createOrder]: Do not have enough balance");

    IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);

    emit CreateOrder(nextOrderId, msg.sender, tokenA, tokenB, amountA, amountB);
    orders[nextOrderId] = Order(
      msg.sender,
      tokenA,
      amountA,
      tokenB,
      amountB,
      OrderStatus.Active
    );
    nextOrderId++;
  }

  function cancelOrder(uint id) external {
    require(id < nextOrderId, "[cancelOrder]: Order does not exist");

    Order storage order = orders[id];
    require(order.creator == msg.sender, "[cancelOrder]: Only creator can cancel order");
    require(order.status == OrderStatus.Active, "[cancelOrder]: Order is not active");

    order.status = OrderStatus.Cancelled;
    IERC20(order.tokenA).safeTransfer(msg.sender, order.amountA);

    emit CancelOrder(id, order.tokenA, order.tokenB, order.amountA, order.amountB);
  }

  function resolveOrder(uint id) external {
    require(id < nextOrderId, "[resolveOrder]: Order does not exist");

    Order storage order = orders[id];
    require(order.status == OrderStatus.Active, "[resolveOrder]: Order is not active");
    require(order.creator != msg.sender, "[resolveOrder]: Cannot resolve own order");

    uint tokenBBalance = IERC20(order.tokenB).balanceOf(msg.sender);
    require(tokenBBalance >= order.amountB, "[resolveOrder]: Do not have enough balance");

    order.status = OrderStatus.Completed;

    IERC20(order.tokenB).safeTransferFrom(msg.sender, order.creator, order.amountB);
    IERC20(order.tokenA).safeTransfer(msg.sender, order.amountA);

    emit ResolveOrder(id, msg.sender, order.tokenA, order.tokenB, order.amountA, order.amountB);
  }
}
