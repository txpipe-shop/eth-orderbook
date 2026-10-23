// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Orderbook {
  using SafeERC20 for IERC20;

  /// @notice Thrown when `amountA` or `amountB` is zero.
  error AmountMustBePositive();
  /// @notice Thrown when `tokenA` and `tokenB` are the same address.
  error TokensMustBeDifferent();
  /// @notice Thrown when a token is the zero address.
  error TokenIsZeroAddress();
  /// @notice Thrown when the deadline is in the past and not zero.
  error DeadlineMustBeInTheFuture();
  /// @notice Thrown when a caller's balance is below the required amount.
  error InsufficientBalance(uint256 available, uint256 required);
  /// @notice Thrown when an order id does not exist.
  error OrderDoesNotExist(uint256 id);
  /// @notice Thrown when an order is not in the Active state.
  error OrderNotActive(uint256 id);
  /// @notice Thrown when someone other than the creator tries to cancel.
  error OnlyCreatorCanCancel(uint256 id);
  /// @notice Thrown when the creator tries to resolve their own order.
  error CannotResolveOwnOrder(uint256 id);
  /// @notice Thrown when an order's deadline has passed.
  error OrderExpired(uint256 id);
  /// @notice Thrown when an order has not yet reached its deadline.
  error OrderNotExpired(uint256 id);
  /// @notice Thrown when the fill amount is zero or exceeds the remaining amount.
  error InvalidFillAmount(uint256 fillAmountA, uint256 remainingA);

  enum OrderStatus { Active, Completed, Cancelled, Expired }

  struct Order {
    address creator;
    address tokenA;
    uint amountA;
    uint remainingA;
    address tokenB;
    uint amountB;
    OrderStatus status;
    // zero on deadline means no deadline
    uint deadline;
  }

  mapping(uint => Order) public orders;
  uint public nextOrderId = 0;

  event CreateOrder(uint id, address creator, address tokenA, address tokenB, uint amountA, uint amountB, uint deadline);
  event ResolveOrder(uint id, address resolver, address tokenA, address tokenB, uint amountA, uint amountB);
  event CancelOrder(uint id, address tokenA, address tokenB, uint amountA, uint amountB);
  event ExpireOrder(uint id, address tokenA, address tokenB, uint amountA, uint amountB);

  function createOrder(
    address tokenA, address tokenB, uint amountA, uint amountB, uint deadline
  ) external {
    if (amountA == 0 || amountB == 0) revert AmountMustBePositive();
    if (tokenA == tokenB) revert TokensMustBeDifferent();
    if (tokenA == address(0) || tokenB == address(0)) revert TokenIsZeroAddress();
    if (deadline != 0 && deadline <= block.timestamp) revert DeadlineMustBeInTheFuture();

    uint tokenABalance = IERC20(tokenA).balanceOf(msg.sender);
    if (tokenABalance < amountA) revert InsufficientBalance(tokenABalance, amountA);

    uint orderId = nextOrderId;
    nextOrderId++;

    orders[orderId] = Order(
      msg.sender,
      tokenA,
      amountA,
      amountA,
      tokenB,
      amountB,
      OrderStatus.Active,
      deadline
    );
    emit CreateOrder(orderId, msg.sender, tokenA, tokenB, amountA, amountB, deadline);

    IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
  }

  function cancelOrder(uint id) external {
    if (id >= nextOrderId) revert OrderDoesNotExist(id);

    Order storage order = orders[id];
    if (order.creator != msg.sender) revert OnlyCreatorCanCancel(id);
    if (order.status != OrderStatus.Active) revert OrderNotActive(id);

    order.status = OrderStatus.Cancelled;
    IERC20(order.tokenA).safeTransfer(msg.sender, order.amountA);

    emit CancelOrder(id, order.tokenA, order.tokenB, order.amountA, order.amountB);
  }

  function resolveOrder(uint id, uint fillAmountA) external {
    if (id >= nextOrderId) revert OrderDoesNotExist(id);

    Order storage order = orders[id];
    if (order.status != OrderStatus.Active) revert OrderNotActive(id);
    if (order.creator == msg.sender) revert CannotResolveOwnOrder(id);
    if (order.deadline != 0 && order.deadline < block.timestamp) revert OrderExpired(id);
    if (fillAmountA == 0 || fillAmountA > order.remainingA) revert InvalidFillAmount(fillAmountA, order.remainingA);

    uint fillAmountB = (fillAmountA * order.amountB + order.amountA - 1) / order.amountA;
    uint tokenBBalance = IERC20(order.tokenB).balanceOf(msg.sender);
    if (tokenBBalance < fillAmountB) revert InsufficientBalance(tokenBBalance, fillAmountB);

    order.remainingA -= fillAmountA;
    if (order.remainingA == 0) {
      order.status = OrderStatus.Completed;
    }

    IERC20(order.tokenB).safeTransferFrom(msg.sender, order.creator, fillAmountB);
    IERC20(order.tokenA).safeTransfer(msg.sender, fillAmountA);

    emit ResolveOrder(id, msg.sender, order.tokenA, order.tokenB, fillAmountA, fillAmountB);
  }

  function expireOrder(uint id) external {
    if (id >= nextOrderId) revert OrderDoesNotExist(id);

    Order storage order = orders[id];
    if (order.deadline == 0 || order.deadline >= block.timestamp) revert OrderNotExpired(id);
    if (order.status != OrderStatus.Active) revert OrderNotActive(id);
    order.status = OrderStatus.Expired;

    IERC20(order.tokenA).safeTransfer(order.creator, order.amountA);
    emit ExpireOrder(id, order.tokenA, order.tokenB, order.amountA, order.amountB);
  }
}
