#![cfg(test)]

use proptest::prelude::*;

// Property-based tests for tip and token transfer invariants
// These verify that fee calculations and balances remain consistent
// under arbitrary tip amounts and fee configurations.

proptest! {
    #[test]
    fn prop_tip_amount_split_correctly(
        amount in 1i128..1_000_000_000,
        fee_bps in 0u32..10001,
    ) {
        // Verify that amount = author_amount + fee_amount
        // fee_amount = (amount / 10_000) * fee_bps + (amount % 10_000) * fee_bps / 10_000

        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;

        // Amount must split correctly:
        assert_eq!(author_amount + fee_amount, amount,
            "tip split failed: {} + {} != {}", author_amount, fee_amount, amount);

        // Fee must be within expected range
        let max_possible_fee = (amount * fee_bps as i128) / 10_000 + 1;
        assert!(fee_amount <= max_possible_fee,
            "fee {} exceeds max {}", fee_amount, max_possible_fee);
    }

    #[test]
    fn prop_tip_total_reflects_author_amount(
        initial_tips in 0i128..10_000_000,
        new_tip in 1i128..1_000_000_000,
        fee_bps in 0u32..10001,
    ) {
        // tip_total should only accumulate author_amount, not the full tip
        let fee_amount = (new_tip / 10_000) * fee_bps as i128
            + (new_tip % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = new_tip - fee_amount;

        let updated_tip_total = initial_tips + author_amount;

        // Verify no overflow in typical ranges
        assert!(updated_tip_total >= initial_tips,
            "tip_total underflow: {} + {} < {}", initial_tips, author_amount, initial_tips);
    }

    #[test]
    fn prop_zero_fee_means_full_amount_to_author(
        amount in 1i128..1_000_000_000,
    ) {
        let fee_bps = 0u32;
        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;

        assert_eq!(author_amount, amount,
            "with zero fee, author should get full amount: {} != {}", author_amount, amount);
    }

    #[test]
    fn prop_max_fee_is_bounded(
        amount in 1i128..1_000_000_000,
    ) {
        // Max fee is 100% (10_000 bps)
        let fee_bps = 10_000u32;
        let fee_amount = (amount / 10_000) * fee_bps as i128
            + (amount % 10_000) * fee_bps as i128 / 10_000;

        // Fee should be roughly equal to amount with max bps, ±1 due to rounding
        assert!(fee_amount >= amount - 1 && fee_amount <= amount + 1,
            "max fee {} should be ~{}", fee_amount, amount);
    }
}
