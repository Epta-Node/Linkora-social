//! Vesting arithmetic, kept free of `Env` so it can be fuzzed directly.

/// Amount of `total` vested at time `now` for a schedule that starts at
/// `start`, unlocks nothing before `start + cliff` and is fully vested at
/// `start + duration`.
///
/// Between the cliff and the end the result is `floor(total * elapsed / duration)`,
/// computed without forming `total * elapsed` (which can overflow `i128`):
/// with `total = q * duration + r`, it equals `q * elapsed + r * elapsed / duration`.
/// `r < duration` and `elapsed < duration`, so `r * elapsed` fits in `u128`
/// whenever `duration < 2^64`.
///
/// Expects `total >= 0`, `duration > 0` and `cliff <= duration`, which
/// `create_vest` enforces.
pub fn vested_amount(total: i128, start: u64, cliff: u64, duration: u64, now: u64) -> i128 {
    if now < start.saturating_add(cliff) {
        return 0;
    }
    let elapsed = now - start;
    if elapsed >= duration {
        return total;
    }

    let total = total as u128;
    let duration = duration as u128;
    let elapsed = elapsed as u128;
    let whole = (total / duration) * elapsed;
    let part = (total % duration) * elapsed / duration;
    (whole + part) as i128
}
