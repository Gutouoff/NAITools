//! Durable metadata for the original reference manager. This is a separate local
//! database: the generation journal, credentials and production schema are untouched.
use crate::{dto::valid_id, error::AppError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, time::Duration};

const MAX_PRESETS: usize = 5000;
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceKind {
    Vibe,
    Precise,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub enum PreciseType {
    #[serde(rename = "character")]
    Character,
    #[serde(rename = "style")]
    Style,
    #[serde(rename = "character&style")]
    CharacterAndStyle,
}
fn one() -> f64 {
    1.0
}
fn character() -> PreciseType {
    PreciseType::Character
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceParameters {
    pub name: String,
    #[serde(default)]
    pub group: String,
    pub kind: ReferenceKind,
    #[serde(default = "one")]
    pub info_extracted: f64,
    #[serde(default = "one")]
    pub strength: f64,
    #[serde(default = "character")]
    pub precise_type: PreciseType,
    #[serde(default = "one")]
    pub fidelity: f64,
    #[serde(default = "one")]
    pub information_extracted: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_names: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_game_names: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_game_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_category: Option<String>,
}
fn text(value: &str, max: usize, empty: bool) -> bool {
    (empty || !value.trim().is_empty())
        && value.chars().count() <= max
        && !value.chars().any(char::is_control)
}
impl ReferenceParameters {
    pub fn validate(&self) -> Result<(), AppError> {
        if !text(&self.name, 120, false)
            || !text(&self.group, 120, true)
            || [
                self.info_extracted,
                self.strength,
                self.fidelity,
                self.information_extracted,
            ]
            .iter()
            .any(|n| !n.is_finite() || !(0.0..=1.0).contains(n))
            || [
                (&self.source_id, 180),
                (&self.source_game_id, 120),
                (&self.source_category, 80),
            ]
            .iter()
            .any(|(s, max)| s.as_ref().is_some_and(|s| !text(s, *max, false)))
            || [&self.source_names, &self.source_game_names]
                .iter()
                .any(|map| {
                    map.as_ref().is_some_and(|map| {
                        map.iter().any(|(k, v)| {
                            !matches!(k.as_str(), "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR")
                                || !text(v, 160, false)
                        })
                    })
                })
        {
            return Err(AppError::invalid());
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRecord {
    pub id: String,
    #[serde(flatten)]
    pub parameters: ReferenceParameters,
    pub extension: String,
    pub created_at_ms: i64,
    pub width: u32,
    pub height: u32,
}
impl ReferenceRecord {
    pub fn validate(&self) -> Result<(), AppError> {
        self.parameters.validate()?;
        if !valid_id(&self.id)
            || !matches!(self.extension.as_str(), "png" | "jpg" | "webp")
            || self.created_at_ms < 0
            || self.created_at_ms > 8_640_000_000_000_000
            || self.width == 0
            || self.height == 0
            || self.width > 8192
            || self.height > 8192
            || u64::from(self.width) * u64::from(self.height) > 16_777_216
        {
            return Err(AppError::invalid());
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
pub struct ReferenceLibrary {
    pub groups: Vec<String>,
    pub presets: Vec<ReferenceRecord>,
}
pub struct ReferenceStore {
    db: Connection,
}
impl ReferenceStore {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::storage_io(&e))?;
        }
        let db = Connection::open(path).map_err(|e| AppError::storage_database(&e))?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| AppError::storage_database(&e))?;
        let version: i64 = db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| AppError::storage_database(&e))?;
        if version > 1 {
            return Err(AppError::new(
                "storage_version_unsupported",
                "参考预设数据库版本不受支持；未修改数据。",
            ));
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(|e| AppError::storage_database(&e))?;
        if version == 0 {
            db.execute_batch(
                "BEGIN IMMEDIATE;
                CREATE TABLE reference_groups(name TEXT PRIMARY KEY);
                CREATE TABLE reference_presets(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                PRAGMA user_version=1; COMMIT;",
            )
            .map_err(|e| AppError::storage_database(&e))?;
        }
        Ok(Self { db })
    }
    pub fn list(&self) -> Result<ReferenceLibrary, AppError> {
        // One read snapshot; concurrent import/group writes cannot split the response.
        self.db
            .execute_batch("BEGIN;")
            .map_err(|e| AppError::storage_database(&e))?;
        let result = (|| {
            let mut statement = self
                .db
                .prepare("SELECT name FROM reference_groups ORDER BY rowid")
                .map_err(|e| AppError::storage_database(&e))?;
            let groups = statement
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| AppError::storage_database(&e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::storage_database(&e))?;
            let mut statement = self
                .db
                .prepare("SELECT id,payload FROM reference_presets ORDER BY rowid DESC")
                .map_err(|e| AppError::storage_database(&e))?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| AppError::storage_database(&e))?;
            let mut presets = Vec::new();
            for row in rows {
                let (id, raw) = row.map_err(|e| AppError::storage_database(&e))?;
                presets.push(parse(&id, &raw)?);
            }
            if presets.len() > MAX_PRESETS || groups.iter().any(|g| !text(g, 120, false)) {
                return Err(corrupt());
            }
            Ok(ReferenceLibrary { groups, presets })
        })();
        self.db
            .execute_batch("ROLLBACK;")
            .map_err(|e| AppError::storage_database(&e))?;
        result
    }
    pub fn read(&self, id: &str) -> Result<ReferenceRecord, AppError> {
        if !valid_id(id) {
            return Err(AppError::invalid());
        }
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT payload FROM reference_presets WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| AppError::storage_database(&e))?;
        parse(
            id,
            &raw.ok_or_else(|| AppError::new("reference_missing", "参考预设不存在；未执行操作。"))?,
        )
    }
    pub fn save(&mut self, record: &ReferenceRecord) -> Result<(), AppError> {
        record.validate()?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::storage_database(&e))?;
        let count: i64 = tx
            .query_row("SELECT count(*) FROM reference_presets", [], |r| r.get(0))
            .map_err(|e| AppError::storage_database(&e))?;
        if count >= MAX_PRESETS as i64 {
            return Err(AppError::new(
                "reference_limit",
                "参考预设数量已达到 5000 项上限。",
            ));
        }
        if !record.parameters.group.is_empty() {
            tx.execute(
                "INSERT OR IGNORE INTO reference_groups(name) VALUES(?1)",
                [&record.parameters.group],
            )
            .map_err(|e| AppError::storage_database(&e))?;
        }
        tx.execute(
            "INSERT INTO reference_presets(id,payload) VALUES(?1,?2)",
            params![
                record.id,
                serde_json::to_string(record).map_err(|_| AppError::invalid())?
            ],
        )
        .map_err(|e| AppError::storage_database(&e))?;
        tx.commit().map_err(|e| AppError::storage_database(&e))
    }
    pub fn delete(&mut self, id: &str) -> Result<(), AppError> {
        if !valid_id(id) {
            return Err(AppError::invalid());
        }
        // Keep the owned asset: applied workbench/history references may still use it.
        self.db
            .execute("DELETE FROM reference_presets WHERE id=?1", [id])
            .map_err(|e| AppError::storage_database(&e))?;
        Ok(())
    }
    pub fn edit_group(&mut self, name: &str, delete: bool) -> Result<(), AppError> {
        let name = name.trim();
        if !text(name, 120, false) {
            return Err(AppError::invalid());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::storage_database(&e))?;
        if delete {
            let mut statement = tx
                .prepare("SELECT id,payload FROM reference_presets")
                .map_err(|e| AppError::storage_database(&e))?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| AppError::storage_database(&e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::storage_database(&e))?;
            drop(statement);
            for (id, raw) in rows {
                let mut row = parse(&id, &raw)?;
                if row.parameters.group == name {
                    row.parameters.group.clear();
                    tx.execute(
                        "UPDATE reference_presets SET payload=?2 WHERE id=?1",
                        params![
                            id,
                            serde_json::to_string(&row).map_err(|_| AppError::storage())?
                        ],
                    )
                    .map_err(|e| AppError::storage_database(&e))?;
                }
            }
            tx.execute("DELETE FROM reference_groups WHERE name=?1", [name])
                .map_err(|e| AppError::storage_database(&e))?;
        } else {
            tx.execute(
                "INSERT OR IGNORE INTO reference_groups(name) VALUES(?1)",
                [name],
            )
            .map_err(|e| AppError::storage_database(&e))?;
        }
        tx.commit().map_err(|e| AppError::storage_database(&e))
    }
    pub fn move_to_group(&mut self, id: &str, group: &str) -> Result<(), AppError> {
        if !valid_id(id) || !text(group, 120, true) {
            return Err(AppError::invalid());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::storage_database(&e))?;
        let raw: Option<String> = tx
            .query_row(
                "SELECT payload FROM reference_presets WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| AppError::storage_database(&e))?;
        let mut row = parse(
            id,
            &raw.ok_or_else(|| AppError::new("reference_missing", "参考预设不存在；未执行操作。"))?,
        )?;
        row.parameters.group = group.trim().into();
        if !row.parameters.group.is_empty() {
            tx.execute(
                "INSERT OR IGNORE INTO reference_groups(name) VALUES(?1)",
                [&row.parameters.group],
            )
            .map_err(|e| AppError::storage_database(&e))?;
        }
        tx.execute(
            "UPDATE reference_presets SET payload=?2 WHERE id=?1",
            params![
                id,
                serde_json::to_string(&row).map_err(|_| AppError::storage())?
            ],
        )
        .map_err(|e| AppError::storage_database(&e))?;
        tx.commit().map_err(|e| AppError::storage_database(&e))
    }
}
fn corrupt() -> AppError {
    AppError::new(
        "storage_corrupt",
        "参考预设数据库损坏；请保留并备份本地数据，未使用默认值覆盖。",
    )
}
fn parse(id: &str, raw: &str) -> Result<ReferenceRecord, AppError> {
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|_| corrupt())?;
    let object = value.as_object().ok_or_else(corrupt)?;
    // Request defaults are allowed only at creation, never when loading durable
    // parameters. A missing saved field must not silently turn into strength 1.
    for key in [
        "id",
        "name",
        "group",
        "kind",
        "infoExtracted",
        "strength",
        "preciseType",
        "fidelity",
        "informationExtracted",
        "extension",
        "createdAtMs",
        "width",
        "height",
    ] {
        if !object.contains_key(key) {
            return Err(corrupt());
        }
    }
    let row: ReferenceRecord = serde_json::from_value(value).map_err(|_| corrupt())?;
    if row.id != id {
        return Err(corrupt());
    }
    row.validate().map_err(|_| corrupt())?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> ReferenceRecord {
        serde_json::from_value(serde_json::json!({"id":"fixture-1","name":"氛围参考","group":"测试","kind":"vibe","infoExtracted":0.7,"strength":0.4,"preciseType":"style","fidelity":0.8,"informationExtracted":1.0,"extension":"png","width":2,"height":3,"createdAtMs":1000})).unwrap()
    }
    #[test]
    fn durable_parameters_and_groups_survive_reopen_and_delete_group() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("refs.sqlite3");
        let mut db = ReferenceStore::open(&path).unwrap();
        db.save(&fixture()).unwrap();
        db.edit_group("空分组", false).unwrap();
        drop(db);
        let mut db = ReferenceStore::open(&path).unwrap();
        let row = db.read("fixture-1").unwrap();
        assert_eq!(row.parameters.info_extracted, 0.7);
        assert_eq!(row.parameters.precise_type, PreciseType::Style);
        db.move_to_group(&row.id, "备用").unwrap();
        db.edit_group("备用", true).unwrap();
        assert_eq!(db.read(&row.id).unwrap().parameters.group, "");
        assert_eq!(db.list().unwrap().presets.len(), 1);
        db.delete(&row.id).unwrap();
        assert!(db.list().unwrap().presets.is_empty());
        assert!(db.list().unwrap().groups.contains(&"空分组".into()));
    }
    #[test]
    fn invalid_parameters_and_corruption_never_fall_back() {
        let root = tempfile::tempdir().unwrap();
        let mut db = ReferenceStore::open(&root.path().join("db")).unwrap();
        let mut row = fixture();
        row.parameters.strength = 1.1;
        assert!(db.save(&row).is_err());
        row = fixture();
        row.id = "../escape".into();
        assert!(db.save(&row).is_err());
        db.save(&fixture()).unwrap();
        db.db
            .execute("UPDATE reference_presets SET payload='{}'", [])
            .unwrap();
        assert_eq!(db.list().unwrap_err().code, "storage_corrupt");
        assert_eq!(db.read("fixture-1").unwrap_err().code, "storage_corrupt");
        let raw: String = db
            .db
            .query_row("SELECT payload FROM reference_presets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(raw, "{}");
        let mut partial = serde_json::to_value(fixture()).unwrap();
        partial.as_object_mut().unwrap().remove("strength");
        db.db
            .execute(
                "UPDATE reference_presets SET payload=?1",
                [serde_json::to_string(&partial).unwrap()],
            )
            .unwrap();
        assert_eq!(db.read("fixture-1").unwrap_err().code, "storage_corrupt");
    }
}
