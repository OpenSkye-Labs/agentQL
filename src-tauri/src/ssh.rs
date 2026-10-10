//! SSH local port-forward tunnel built on russh.
//! `Tunnel::open` binds 127.0.0.1:<random> and forwards every accepted socket
//! through a direct-tcpip channel to `remote_host:remote_port`.

use crate::config::{SshAuth, SshConfig};
use crate::error::{AppError, Result};
use russh::client;
use russh::keys::{PrivateKeyWithHashAlg, load_secret_key};
use std::sync::Arc;
use tokio::net::TcpListener;

struct Handler {
    host_id: String,
    known_hosts_path: std::path::PathBuf,
}

/// Trust-on-first-use host key pinning stored as `{ "host:port": "fingerprint" }`.
/// A changed key is rejected until the user removes the entry (Connection menu → Forget SSH host key).
impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &russh::keys::PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let fp = match key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => {
                key.fingerprint(Default::default()).to_string()
            }
            russh::keys::PublicKeyOrCertificate::Certificate(c) => {
                c.public_key().fingerprint(Default::default()).to_string()
            }
        };
        let mut known: std::collections::HashMap<String, String> =
            std::fs::read(&self.known_hosts_path)
                .ok()
                .and_then(|d| serde_json::from_slice(&d).ok())
                .unwrap_or_default();
        match known.get(&self.host_id) {
            Some(stored) if stored == &fp => Ok(true),
            Some(stored) => {
                eprintln!(
                    "ssh host key changed for {}: stored {stored}, got {fp}",
                    self.host_id
                );
                Ok(false)
            }
            None => {
                known.insert(self.host_id.clone(), fp);
                if let Ok(data) = serde_json::to_vec_pretty(&known) {
                    let _ = std::fs::write(&self.known_hosts_path, data);
                }
                Ok(true)
            }
        }
    }
}

pub fn forget_host(known_hosts_path: &std::path::Path, host: &str, port: u16) -> Result<()> {
    let mut known: std::collections::HashMap<String, String> = std::fs::read(known_hosts_path)
        .ok()
        .and_then(|d| serde_json::from_slice(&d).ok())
        .unwrap_or_default();
    known.remove(&format!("{host}:{port}"));
    std::fs::write(known_hosts_path, serde_json::to_vec_pretty(&known)?)?;
    Ok(())
}

pub struct Tunnel {
    pub local_port: u16,
    abort: tokio::task::AbortHandle,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.abort.abort();
    }
}

impl Tunnel {
    pub async fn open(
        cfg: &SshConfig,
        password: Option<&str>,
        key_passphrase: Option<&str>,
        remote_host: &str,
        remote_port: u16,
        known_hosts_path: std::path::PathBuf,
    ) -> Result<Tunnel> {
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(600)),
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            ..Default::default()
        });
        let handler = Handler {
            host_id: format!("{}:{}", cfg.host, cfg.port),
            known_hosts_path,
        };
        let mut session = client::connect(config, (cfg.host.as_str(), cfg.port), handler).await.map_err(|e| {
            let hint = if matches!(e, russh::Error::UnknownKey) {
                " (host key changed since it was first trusted; use 'Forget SSH host key' on the connection if this is expected)"
            } else {
                ""
            };
            AppError::Msg(format!("ssh connect to {}:{} failed: {e}{hint}", cfg.host, cfg.port))
        })?;

        let auth = match &cfg.auth {
            SshAuth::Password => {
                let pw = password.ok_or_else(|| AppError::Msg("ssh password required".into()))?;
                session
                    .authenticate_password(cfg.user.clone(), pw)
                    .await
                    .map_err(|e| AppError::Msg(format!("ssh auth failed: {e}")))?
            }
            SshAuth::KeyFile { path } => {
                let path = shellexpand_home(path);
                let key = load_secret_key(&path, key_passphrase)
                    .map_err(|e| AppError::Msg(format!("could not load ssh key {path}: {e}")))?;
                let hash = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| AppError::Msg(e.to_string()))?
                    .flatten();
                session
                    .authenticate_publickey(
                        cfg.user.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| AppError::Msg(format!("ssh auth failed: {e}")))?
            }
            SshAuth::Agent => authenticate_with_agent(&mut session, &cfg.user).await?,
        };

        if !matches!(auth, russh::client::AuthResult::Success) {
            return Err(AppError::Msg("ssh authentication rejected".into()));
        }

        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let local_port = listener.local_addr()?.port();
        let session = Arc::new(session);
        let remote_host = remote_host.to_string();

        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, peer)) = listener.accept().await else {
                    break;
                };
                let session = session.clone();
                let remote_host = remote_host.clone();
                tokio::spawn(async move {
                    match session
                        .channel_open_direct_tcpip(
                            remote_host,
                            remote_port as u32,
                            peer.ip().to_string(),
                            peer.port() as u32,
                        )
                        .await
                    {
                        Ok(channel) => {
                            let mut stream = channel.into_stream();
                            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                        }
                        Err(e) => eprintln!("ssh forward failed: {e}"),
                    }
                });
            }
        });

        Ok(Tunnel {
            local_port,
            abort: task.abort_handle(),
        })
    }
}

async fn authenticate_with_agent(
    session: &mut client::Handle<Handler>,
    user: &str,
) -> std::result::Result<russh::client::AuthResult, AppError> {
    use russh::keys::agent::client::AgentClient;
    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| AppError::Msg(format!("ssh-agent unavailable: {e}")))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| AppError::Msg(format!("ssh-agent identities: {e}")))?;
    if identities.is_empty() {
        return Err(AppError::Msg("ssh-agent holds no keys".into()));
    }
    for id in identities {
        let key = id.public_key().into_owned();
        let hash = session
            .best_supported_rsa_hash()
            .await
            .map_err(|e| AppError::Msg(e.to_string()))?
            .flatten();
        let result = session
            .authenticate_publickey_with(user.to_string(), key, hash, &mut agent)
            .await
            .map_err(|e| AppError::Msg(e.to_string()))?;
        if matches!(result, russh::client::AuthResult::Success) {
            return Ok(result);
        }
    }
    Err(AppError::Msg(
        "ssh-agent: no key was accepted by the server".into(),
    ))
}

fn shellexpand_home(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/")
        && let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
    {
        return format!("{}/{}", home.to_string_lossy(), rest);
    }
    p.to_string()
}
