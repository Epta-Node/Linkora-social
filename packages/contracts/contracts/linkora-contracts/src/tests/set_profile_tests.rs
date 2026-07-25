//! Unit tests for `set_profile` username length validation.

#[cfg(test)]
mod set_profile_tests {
    use super::*;
    use soroban_sdk::{Address, Env, String};

    #[test]
    #[should_panic(expected = "username too short")]
    fn test_set_profile_username_too_short_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup_contract(&env);

        let user = Address::generate(&env);
        let token = Address::generate(&env);
        // 2-character username should panic
        client.set_profile(&user, &String::from_str(&env, "ab"), &token);
    }

    #[test]
    fn test_set_profile_username_minimum_length_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup_contract(&env);

        let user = Address::generate(&env);
        let token = Address::generate(&env);
        // 3-character username should succeed
        client.set_profile(&user, &String::from_str(&env, "abc"), &token);
        let profile = client.get_profile(&user).unwrap();
        assert_eq!(profile.username, String::from_str(&env, "abc"));
    }
}
