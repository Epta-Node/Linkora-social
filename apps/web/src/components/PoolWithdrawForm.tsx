"use client";

import type { ComponentProps } from "react";
import { WithdrawTab } from "./pools/WithdrawTab";

/**
 * Withdrawal form for the /pools/[id] page: amount + recipient validation and
 * the multi-sig withdrawal flow, which requires `threshold` admin signatures.
 *
 * The form logic lives in components/pools/WithdrawTab. This is a thin wrapper
 * that exposes it under the name referenced by the pool-detail spec, so callers
 * can import PoolWithdrawForm without the implementation being duplicated.
 */
export type PoolWithdrawFormProps = ComponentProps<typeof WithdrawTab>;

export function PoolWithdrawForm(props: PoolWithdrawFormProps) {
  return <WithdrawTab {...props} />;
}

export default PoolWithdrawForm;
