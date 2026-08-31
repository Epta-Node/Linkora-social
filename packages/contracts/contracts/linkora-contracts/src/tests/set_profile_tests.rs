//! Unit tests for `set_profile` username validation.

use super::*;

#[test]
#[should_panic(expected = "username must be at least 3 characters")]
fn test_set_profile_username_too_short_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // 2-character username should panic (MIN_NAME_LEN = 3)
    client.set_profile(&user, &String::from_str(&env, "ab"), &token);
}

#[test]
fn test_set_profile_username_minimum_length_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // 3-character username should succeed (MIN_NAME_LEN = 3)
    client.set_profile(&user, &String::from_str(&env, "abc"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "abc"));
}

#[test]
#[should_panic(expected = "username must start with a letter")]
fn test_set_profile_username_starting_with_number_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username starting with a digit should panic
    client.set_profile(&user, &String::from_str(&env, "1user"), &token);
}

#[test]
#[should_panic(expected = "username must start with a letter")]
fn test_set_profile_username_starting_with_underscore_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username starting with underscore should panic
    client.set_profile(&user, &String::from_str(&env, "_user"), &token);
}

#[test]
#[should_panic(expected = "username can only contain alphanumeric characters and underscores")]
fn test_set_profile_username_with_special_chars_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username with special characters should panic
    client.set_profile(&user, &String::from_str(&env, "user@name"), &token);
}

#[test]
fn test_set_profile_username_with_underscore_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // Username with underscore should succeed
    client.set_profile(&user, &String::from_str(&env, "user_name"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "user_name"));
}
