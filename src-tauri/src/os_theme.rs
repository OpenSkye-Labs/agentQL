//! OS light/dark preference where the WebView cannot see it. WebKitGTK's `prefers-color-scheme` only follows
//! the GTK theme, which stays light under GNOME's dark style and under WSLg on a dark Windows host, so "Follow
//! system" rendered light there. macOS and Windows WebViews report the OS correctly: `None` means "trust the
//! WebView's media query".
// ponytail: GNOME (gsettings) and WSL only; add the XDG settings portal when KDE/other desktops need it.

use std::process::Command;

pub fn detect() -> Option<&'static str> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    if std::env::var_os("WSL_DISTRO_NAME").is_some() {
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        return parse_reg(&run("reg.exe", &["query", key, "/v", "AppsUseLightTheme"])?);
    }
    parse_gsettings(&run(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "color-scheme"],
    )?)
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `    AppsUseLightTheme    REG_DWORD    0x0` (0 = dark apps).
fn parse_reg(out: &str) -> Option<&'static str> {
    match out
        .split_whitespace()
        .skip_while(|w| *w != "REG_DWORD")
        .nth(1)?
    {
        "0x0" => Some("dark"),
        "0x1" => Some("light"),
        _ => None,
    }
}

/// `'prefer-dark'`; `'default'` is "no preference", left to the WebView.
fn parse_gsettings(out: &str) -> Option<&'static str> {
    match out.trim().trim_matches('\'') {
        "prefer-dark" => Some("dark"),
        "prefer-light" => Some("light"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_registry_output() {
        let out = "\r\nHKEY_CURRENT_USER\\...\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    0x0\r\n\r\n";
        assert_eq!(parse_reg(out), Some("dark"));
        assert_eq!(parse_reg(&out.replace("0x0", "0x1")), Some("light"));
        assert_eq!(parse_reg("ERROR: not found"), None);
    }

    #[test]
    fn parses_gsettings_output() {
        assert_eq!(parse_gsettings("'prefer-dark'\n"), Some("dark"));
        assert_eq!(parse_gsettings("'prefer-light'\n"), Some("light"));
        assert_eq!(parse_gsettings("'default'\n"), None);
    }
}
