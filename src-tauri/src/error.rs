use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("not connected: {0}")]
    NotConnected(String),
    #[error(transparent)]
    Any(#[from] anyhow::Error),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Msg(s)
    }
}
impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Msg(s.to_string())
    }
}
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // Surface the database's own message when there is one.
        match &e {
            sqlx::Error::Database(d) => AppError::Msg(d.message().to_string()),
            _ => AppError::Msg(e.to_string()),
        }
    }
}
impl From<redis::RedisError> for AppError {
    fn from(e: redis::RedisError) -> Self {
        AppError::Msg(e.to_string())
    }
}
impl From<mongodb::error::Error> for AppError {
    fn from(e: mongodb::error::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}
impl From<csv::Error> for AppError {
    fn from(e: csv::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
