use agentql_lib::config::strip_url_password;

#[test]
fn query_password_is_not_persisted() {
    let (clean, pw) =
        strip_url_password("postgres://app@db:5432/app?sslmode=require&password=dummy-pw");
    assert!(
        !clean.contains("dummy-pw"),
        "password left in persisted url: {clean}"
    );
    assert_eq!(pw.as_deref(), Some("dummy-pw"));
}
