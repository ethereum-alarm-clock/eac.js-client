import { AbortReason, ExecuteStatus } from '../Enum';

const EXECUTED_EVENT = '0x3e504bb8b225ad41f613b0c3c4205cdd752d1615b4d77cd1773417282fcfb5d9';
const ABORTED_EVENT = '0xc008bc849b42227c61d5063a1313ce509a6e99211bfd59e827e417be6c65c81b';
const abortReasonToExecuteStatus = new Map<AbortReason, ExecuteStatus>([
  [AbortReason.WasCancelled, ExecuteStatus.ABORTED_WAS_CANCELLED],
  [AbortReason.AlreadyCalled, ExecuteStatus.ABORTED_ALREADY_CALLED],
  [AbortReason.BeforeCallWindow, ExecuteStatus.ABORTED_BEFORE_CALL_WINDOW],
  [AbortReason.AfterCallWindow, ExecuteStatus.ABORTED_AFTER_CALL_WINDOW],
  [AbortReason.ReservedForClaimer, ExecuteStatus.ABORTED_RESERVED_FOR_CLAIMER],
  [AbortReason.InsufficientGas, ExecuteStatus.ABORTED_INSUFFICIENT_GAS],
  [AbortReason.TooLowGasPrice, ExecuteStatus.ABORTED_TOO_LOW_GAS_PRICE],
  [AbortReason.Unknown, ExecuteStatus.ABORTED_UNKNOWN]
]);

const isExecuted = (receipt: any) => {
  if (receipt) {
    return receipt.logs[0].topics.indexOf(EXECUTED_EVENT) > -1;
  }

  return false;
};

const isAborted = (receipt: any) => {
  if (receipt) {
    return receipt.logs[0].topics.indexOf(ABORTED_EVENT) > -1;
  }

  return false;
};

const getAbortedExecuteStatus = (receipt: any) => {
  const reason = parseInt(receipt.logs[0].data, 16);
  const abortReason = receipt && !isNaN(reason) ? (reason as AbortReason) : AbortReason.Unknown;

  return abortReasonToExecuteStatus.get(abortReason) || ExecuteStatus.ABORTED_UNKNOWN;
};

const isTransactionStatusSuccessful = (status: string | number) => {
  if (status) {
    return [1, '0x1', '0x01'].indexOf(status) !== -1;
  }
  return false;
};

export {
  isExecuted,
  isAborted,
  getAbortedExecuteStatus,
  isTransactionStatusSuccessful,
  EXECUTED_EVENT,
  ABORTED_EVENT
};
