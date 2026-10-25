//! The help links: the documentation and the issue tracker. The window asks for one by name
//! ([`Link`]) and never by address, and the Help menu (`menu.rs`) hands the same two names to the
//! window, so the only addresses EnvRouter opens are the ones listed here, all under the
//! repository. That is why it needs no `opener:allow-open-url` permission, scoped or not: the
//! plugin's Rust API isn't behind capabilities, and a permission would let the window ask for a
//! URL of its own choosing.
//!
//! What a failure can tell. The opener hands the address to the system's launcher (`open` on
//! macOS, `xdg-open` and its kin elsewhere). On macOS the launcher's exit status comes back, so a
//! refusal is reported. Elsewhere the launcher is started detached, because `xdg-open` can stay
//! until a browser it started exits, which would hold the caller for as long: only a failure to
//! start any launcher (none installed, as in a minimal WSL distro) is reported, and a launcher
//! that starts and finds no browser is not. Waiting for it isn't worth freezing the button.

use envrouter_core::{Error, Result};
use serde::{Deserialize, Serialize};

/// The project's own address, which every [`Link`] begins with (a test holds them to it).
macro_rules! repository {
    () => {
        "https://github.com/pixel-perfect-software/env-router"
    };
}

/// `HelpLink` in `src/lib/types.ts`; `src/lib/helpLinks.json` repeats the labels and addresses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Link {
    Docs,
    ReportIssue,
}

impl Link {
    /// In the order the Help menu lists them.
    pub const ALL: [Self; 2] = [Self::Docs, Self::ReportIssue];

    pub const fn url(self) -> &'static str {
        match self {
            Self::Docs => concat!(repository!(), "#readme"),
            Self::ReportIssue => concat!(repository!(), "/issues/new"),
        }
    }

    /// The menu item's text, which only the macOS menu bar shows (the window has its own words, in `helpLinks.json`).
    #[cfg(any(target_os = "macos", test))]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Docs => "EnvRouter Documentation",
            Self::ReportIssue => "Report an Issue",
        }
    }

    pub const fn menu_id(self) -> &'static str {
        match self {
            Self::Docs => "help-docs",
            Self::ReportIssue => "help-report-issue",
        }
    }

    pub fn from_menu_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|link| link.menu_id() == id)
    }
}

/// What the window shows when the launcher couldn't start: the reason, and the address to open by hand.
fn failure(link: Link, err: &dyn std::fmt::Display) -> String {
    format!("{err}. It's at {}.", link.url())
}

/// Opens the link in the default browser.
pub fn open(link: Link) -> Result<()> {
    tauri_plugin_opener::open_url(link.url(), None::<&str>)
        .map_err(|err| Error::Command(failure(link, &err)))
}

#[cfg(test)]
mod tests {
    use super::{failure, Link};

    /// The window names a link; it cannot make EnvRouter open an address of its choosing, so
    /// every address that can be opened is this project's own (not merely a `github.com` one,
    /// and not a prefix of another repository's name).
    #[test]
    fn opens_only_addresses_in_the_repository() {
        for link in Link::ALL {
            let url = link.url();
            let rest = url
                .strip_prefix(repository!())
                .unwrap_or_else(|| panic!("{url} is outside the repository"));
            assert!(
                rest.starts_with(['/', '#']),
                "{url} continues the repository's name"
            );
        }
    }

    #[test]
    fn a_menu_id_names_its_link_and_no_other_item_does() {
        for link in Link::ALL {
            assert_eq!(Link::from_menu_id(link.menu_id()), Some(link));
        }
        assert_eq!(Link::from_menu_id("app-quit"), None);
    }

    /// `HelpLink` in `src/lib/types.ts`, and `src/lib/helpLinks.json`: what the window shows
    /// beside a link and what its browser mock answers.
    #[test]
    fn the_windows_words_for_the_links_match_these() {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../../src/lib/helpLinks.json")).unwrap();
        assert_eq!(file.as_object().unwrap().len(), Link::ALL.len());
        for link in Link::ALL {
            let name = serde_json::to_value(link).unwrap();
            let theirs = &file[name.as_str().unwrap()];
            assert_eq!(theirs["label"], link.label());
            assert_eq!(theirs["url"], link.url());
        }
    }

    /// The browser mock answers with this text, pinned in `mockTauri.test.ts`.
    #[test]
    fn a_failure_says_why_and_where_the_page_is() {
        assert_eq!(
            failure(Link::Docs, &"No such file or directory (os error 2)"),
            "No such file or directory (os error 2). It's at https://github.com/pixel-perfect-software/env-router#readme."
        );
    }
}
