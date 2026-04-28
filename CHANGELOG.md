# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for contract releases.

## [0.1.0] - 2026-04-27

### Added
- `LinkoraContract` initial public interface for profile registration, follow graph, post publishing, tipping, and pools.
- Admin-controlled protocol fee configuration via `set_fee`, `set_treasury`, `get_fee_bps`, and `get_treasury`.
- Blocking and post-like primitives (`block_user`, `unblock_user`, `is_blocked`, `like_post`, `get_like_count`, `has_liked`).
- Safer error messages for missing entities in `tip`, `delete_post`, and `pool_withdraw`.

### Changed
- `tip` now supports protocol fee split between author and treasury.
- Contract crate version aligned to `0.1.0` in `packages/contracts/contracts/linkora-contracts/Cargo.toml`.
