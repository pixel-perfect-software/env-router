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
