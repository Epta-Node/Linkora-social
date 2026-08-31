"use client";

import type { ComponentProps } from "react";
import { DepositTab } from "./pools/DepositTab";

/**
 * Deposit form for the /pools/[id] page: amount + token validation followed by
 * the allowance/deposit transaction flow.
 *
 * The form logic lives in components/pools/DepositTab. This is a thin wrapper
 * that exposes it under the name referenced by the pool-detail spec, so callers
 * can import PoolDepositForm without the implementation being duplicated.
 */
export type PoolDepositFormProps = ComponentProps<typeof DepositTab>;

export function PoolDepositForm(props: PoolDepositFormProps) {
  return <DepositTab {...props} />;
}

export default PoolDepositForm;
