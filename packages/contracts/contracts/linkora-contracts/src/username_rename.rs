// Issue #1674: Username rename with tombstone of old names
//
// Provides explicit rename_username that atomically updates index, profile, and emits an event.
// Optionally holds old name for a cooldown period to prevent squatting races.

use crate::*;

// Cooldown period in ledgers (default ~30 days at 5s/ledger)
const DEFAULT_RENAME_COOLDOWN_LEDGERS: u32 = 518_400;
const RENAME_COOLDOWN_KEY: Symbol = symbol_short!("REN_CD");

#[contracttype]
#[derive(Clone)]
pub struct UsernameTombstone {
    pub old_username: String,
    pub released_at_ledger: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct UsernameRenamedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub user: Address,
    pub old_username: String,
    pub new_username: String,
}

impl LinkoraContract {
    /// Rename a user's username atomically
    /// 
    /// Enforces:
    /// - User authentication
    /// - New username is available
    /// - Old username is placed in cooldown tombstone
    /// - Atomic swap of UsernameIndex entries
    pub fn rename_username(env: Env, user: Address, new_username: String) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        validate_username(&env, &new_username);

        // Get current profile
        let profile_key = StorageKey::Profile(user.clone());
        let profile: Profile = env
            .storage()
            .persistent()
            .get(&profile_key)
            .expect("profile not found");

        let old_username = profile.username.clone();

        // Prevent same-name rename
        if old_username == new_username {
            panic!("new username is same as current");
        }

        // Check if new username is available
        let new_username_key = StorageKey::UsernameIndex(new_username.clone());
        if let Some(existing_owner) = env
            .storage()
            .persistent()
            .get::<_, Address>(&new_username_key)
        {
            // Check if it's in cooldown
            let tombstone_key = StorageKey::UsernameTombstone(new_username.clone());
            if env.storage().persistent().has(&tombstone_key) {
                let tombstone: UsernameTombstone =
                    env.storage().persistent().get(&tombstone_key).unwrap();
                if env.ledger().sequence() < tombstone.released_at_ledger {
                    panic!("username in cooldown period");
                }
                // Cooldown expired, remove tombstone
                env.storage().persistent().remove(&tombstone_key);
            } else if existing_owner != user {
                panic!("username taken");
            }
        }

        // Atomic swap: Remove old index, add new index
        let old_username_key = StorageKey::UsernameIndex(old_username.clone());
        env.storage().persistent().remove(&old_username_key);
        env.storage()
            .persistent()
            .set(&new_username_key, &user);
        Self::bump(&env, &new_username_key);

        // Update profile with new username
        let updated_profile = Profile {
            address: user.clone(),
            username: new_username.clone(),
            creator_token: profile.creator_token,
        };
        env.storage().persistent().set(&profile_key, &updated_profile);
        Self::bump(&env, &profile_key);

        // Create tombstone for old username
        let cooldown_ledgers: u32 = env
            .storage()
            .instance()
            .get(&RENAME_COOLDOWN_KEY)
            .unwrap_or(DEFAULT_RENAME_COOLDOWN_LEDGERS);

        let tombstone = UsernameTombstone {
            old_username: old_username.clone(),
            released_at_ledger: env.ledger().sequence() + cooldown_ledgers,
        };
        let tombstone_key = StorageKey::UsernameTombstone(old_username.clone());
        env.storage().persistent().set(&tombstone_key, &tombstone);
        Self::bump(&env, &tombstone_key);

        // Emit event
        UsernameRenamedEvent {
            version: EVENT_VERSION,
            user,
            old_username,
            new_username,
        }
        .publish(&env);
    }

    /// Admin function to configure rename cooldown period
    pub fn set_rename_cooldown(env: Env, admin: Address, cooldown_ledgers: u32) {
        Self::require_admin(&env, &admin);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&RENAME_COOLDOWN_KEY, &cooldown_ledgers);
    }

    /// Get current rename cooldown period
    pub fn get_rename_cooldown(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&RENAME_COOLDOWN_KEY)
            .unwrap_or(DEFAULT_RENAME_COOLDOWN_LEDGERS)
    }
}

// Add UsernameTombstone to StorageKey enum
// Note: This would be added to the main lib.rs StorageKey enum:
// UsernameTombstone(String), // persistent: old_username -> UsernameTombstone
