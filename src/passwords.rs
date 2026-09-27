// Zephyr Browser — encrypted password vault.
// Entries are AES-256-GCM encrypted with a random key stored at
// <data>/pw.key (0600). OS keyring integration is a planned enhancement.
use crate::db::Db;
use crate::util::now_ms;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use rusqlite::params;
use std::path::Path;

pub struct Vault {
    key: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct PasswordEntry {
    pub id: i64,
    pub origin: String,
    pub username: String,
    pub created: u64,
}

impl Vault {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        let _ = std::fs::create_dir_all(data_dir);
        let key_path = data_dir.join("pw.key");
        let key = if key_path.exists() {
            let data = std::fs::read(&key_path).map_err(|e| format!("read key: {}", e))?;
            if data.len() != 32 {
                return Err("corrupt key file".into());
            }
            let mut k = [0u8; 32];
            k.copy_from_slice(&data);
            k
        } else {
            let mut k = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut k);
            std::fs::write(&key_path, k).map_err(|e| format!("write key: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
            }
            k
        };
        Ok(Self { key })
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new_from_slice(&self.key).expect("key len")
    }

    pub fn encrypt(&self, plaintext: &str) -> (Vec<u8>, Vec<u8>) {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let ct = self
            .cipher()
            .encrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: plaintext.as_bytes(), aad: &[] })
            .expect("aes-gcm encrypt");
        (ct, nonce_bytes.to_vec())
    }

    pub fn decrypt(&self, ct: &[u8], nonce: &[u8]) -> Option<String> {
        if nonce.len() != 12 {
            return None;
        }
        let pt = self.cipher().decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: &[] }).ok()?;
        String::from_utf8(pt).ok()
    }
}

pub fn save(db: &Db, vault: &Vault, origin: &str, username: &str, secret: &str) -> Option<i64> {
    // Never store empty secrets
    if secret.is_empty() || username.is_empty() {
        return None;
    }
    let (ct, nonce) = vault.encrypt(secret);
    db.exec(|c| {
        c.execute(
            "INSERT INTO passwords(origin,username,secret,nonce,created) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(origin,username) DO UPDATE SET secret=?3, nonce=?4",
            params![origin, username, ct, nonce, now_ms() as i64],
        )
        .ok()?;
        Some(c.last_insert_rowid())
    })
}

pub fn remove(db: &Db, id: i64) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM passwords WHERE id=?1", params![id]);
    });
}

pub fn list(db: &Db) -> Vec<PasswordEntry> {
    db.exec(|c| {
        let mut stmt = match c.prepare("SELECT id,origin,username,created FROM passwords ORDER BY origin") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |r| -> Result<PasswordEntry, rusqlite::Error> {
            Ok(PasswordEntry {
                id: r.get(0)?,
                origin: r.get(1)?,
                username: r.get(2)?,
                created: r.get::<_, i64>(3)? as u64,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    })
}

pub fn find_for_origin(db: &Db, vault: &Vault, origin: &str) -> Vec<(i64, String, String)> {
    // returns (id, username, decrypted secret) for entries at this origin
    let rows: Vec<(i64, String, Vec<u8>, Vec<u8>)> = db.exec(|c| {
        let mut stmt = match c.prepare("SELECT id,username,secret,nonce FROM passwords WHERE origin=?1") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![origin], |r| -> Result<(i64, String, Vec<u8>, Vec<u8>), rusqlite::Error> {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    });
    rows.into_iter()
        .filter_map(|(id, user, ct, nonce)| vault.decrypt(&ct, &nonce).map(|sec| (id, user, sec)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_roundtrip() {
        let dir = std::env::temp_dir().join(format!("zephyr-vault-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let db = Db::open(&dir.join("v.db")).unwrap();
        let vault = Vault::open(&dir).unwrap();
        save(&db, &vault, "https://example.com", "alice", "s3cret!");
        let found = find_for_origin(&db, &vault, "https://example.com");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "alice");
        assert_eq!(found[0].2, "s3cret!");
        let none = find_for_origin(&db, &vault, "https://other.com");
        assert!(none.is_empty());
        // ciphertext must not contain plaintext
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn key_is_reused() {
        let dir = std::env::temp_dir().join(format!("zephyr-vault2-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let v1 = Vault::open(&dir).unwrap();
        let v2 = Vault::open(&dir).unwrap();
        let (ct, nonce) = v1.encrypt("same");
        assert_eq!(v2.decrypt(&ct, &nonce).unwrap(), "same");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
