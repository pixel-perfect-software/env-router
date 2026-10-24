use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not find your home directory")]
    NoHome,
    #[error("{}: {source}", path.display())]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{} is not valid JSON: {source}", path.display())]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    /// Something the user has to fix. The message is shown to them as is.
    #[error("{0}")]
    Invalid(String),
    /// A helper process (a shell, the shim) failed or timed out.
    #[error("{0}")]
    Command(String),
    /// The platform's secret store (the Keychain, a keyring) refused or failed. Each store
    /// words its own message, naming itself.
    #[error("{0}")]
    SecretStore(String),
}

/// What a caller may need to tell apart in a failure without reading its message, which is
/// for people. Sent with the window's config read, so it knows whether Start Over can help.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// A file that isn't valid JSON for its type (`config.json` that won't parse).
    Parse,
    Other,
}

impl Error {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Json { .. } => ErrorKind::Parse,
            _ => ErrorKind::Other,
        }
    }
}

// Tauri commands reject with this, so the frontend receives the message string.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
