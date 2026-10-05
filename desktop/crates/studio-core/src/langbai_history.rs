//! Original history contracts backed by the existing database. Images and
//! credentials never travel in this listing; media is loaded on demand.
use crate::{dto::{valid_id, HistoryCursor}, error::AppError, generation::GenerationInput, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryFilter {
    pub from_ms: Option<i64>,
    pub until_ms: Option<i64>,
    pub group_id: Option<String>,
    pub before: Option<HistoryCursor>,
}
impl HistoryFilter {
    fn validate(&self) -> Result<(), AppError> {
        if self.from_ms.is_some() != self.until_ms.is_some()
            || self.from_ms.is_some_and(|n| n < 0)
            || self.until_ms.is_some_and(|n| n > 8_640_000_000_000_000)
            || self.from_ms.zip(self.until_ms).is_some_and(|(a,b)| a >= b)
            || self.group_id.as_ref().is_some_and(|id| id != "__ungrouped" && !valid_id(id))
            || self.before.as_ref().is_some_and(|c| c.created_at_ms < 0 || !valid_id(&c.id))
        { return Err(AppError::invalid()); }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReceipt {
    pub id: String,
    pub artifact_id: String,
    pub created_at_ms: i64,
    pub group_id: Option<String>,
    pub request: Option<GenerationInput>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptPage { pub items: Vec<HistoryReceipt>, pub next_cursor: Option<HistoryCursor> }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryGroup { pub id: String, pub name: String, pub created_at_ms: i64 }

impl Store {
    pub fn langbai_history_page(&self, filter: &HistoryFilter) -> Result<ReceiptPage, AppError> {
        filter.validate()?;
        let mut statement = self.db.prepare("SELECT h.id,h.artifact_id,h.created_at_ms,m.group_id,h.request_json
            FROM history h LEFT JOIN history_memberships m ON m.history_id=h.id
            WHERE (?1 IS NULL OR (h.created_at_ms>=?1 AND h.created_at_ms<?2))
              AND (?3 IS NULL OR (?3='__ungrouped' AND m.group_id IS NULL) OR m.group_id=?3)
              AND (?4 IS NULL OR h.created_at_ms<?4 OR (h.created_at_ms=?4 AND h.id<?5))
            ORDER BY h.created_at_ms DESC,h.id DESC LIMIT 101").map_err(|e| AppError::storage_database(&e))?;
        let rows = statement.query_map(params![filter.from_ms, filter.until_ms, filter.group_id,
            filter.before.as_ref().map(|c| c.created_at_ms), filter.before.as_ref().map(|c| &c.id)], |row| {
            Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,i64>(2)?,
                row.get::<_,Option<String>>(3)?,row.get::<_,Option<String>>(4)?))
        }).map_err(|e| AppError::storage_database(&e))?;
        let mut items = Vec::new();
        for row in rows {
            let (id,artifact_id,created_at_ms,group_id,raw) = row.map_err(|e| AppError::storage_database(&e))?;
            if !valid_id(&id) || !valid_id(&artifact_id) || created_at_ms < 0 { return Err(AppError::storage()); }
            let request = raw.map(|text| {
                if text.len() > 262_144 { return Err(AppError::storage()); }
                let mut input: GenerationInput = serde_json::from_str(&text).map_err(|_| AppError::storage())?;
                // A historical receipt is never authorization to make another paid request.
                input.confirm_paid = false;
                Ok(input)
            }).transpose()?;
            items.push(HistoryReceipt { id,artifact_id,created_at_ms,group_id,request });
        }
        let next_cursor = if items.len() > 100 {
            items.truncate(100);
            items.last().map(|item| HistoryCursor { id:item.id.clone(),created_at_ms:item.created_at_ms })
        } else { None };
        Ok(ReceiptPage { items,next_cursor })
    }
    /// Local-calendar days, matching the original new Date()/date-fns behavior.
    /// Only one timestamp per day crosses IPC; no image IO or parameter parsing.
    pub fn langbai_history_days(&self) -> Result<Vec<i64>, AppError> {
        let mut statement = self.db.prepare("SELECT MAX(created_at_ms) FROM history
            GROUP BY date(created_at_ms/1000,'unixepoch','localtime') ORDER BY MAX(created_at_ms) DESC")
            .map_err(|e| AppError::storage_database(&e))?;
        let rows = statement.query_map([], |r| r.get(0)).map_err(|e| AppError::storage_database(&e))?;
        rows.map(|r| r.map_err(|e| AppError::storage_database(&e))).collect()
    }
    pub fn langbai_history_groups(&self) -> Result<Vec<HistoryGroup>, AppError> {
        let mut statement = self.db.prepare("SELECT id,name,created_at_ms FROM history_groups ORDER BY created_at_ms,id")
            .map_err(|e| AppError::storage_database(&e))?;
        let rows = statement.query_map([], |r| Ok(HistoryGroup { id:r.get(0)?,name:r.get(1)?,created_at_ms:r.get(2)? }))
            .map_err(|e| AppError::storage_database(&e))?;
        rows.map(|r| r.map_err(|e| AppError::storage_database(&e))).collect()
    }
    pub fn langbai_create_history_group(&mut self, id: &str, name: &str, at: i64) -> Result<Vec<HistoryGroup>, AppError> {
        if !valid_id(id) || at < 0 { return Err(AppError::invalid()); }
        let name = group_name(name)?;
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| AppError::storage_database(&e))?;
        let names: Vec<String> = {
            let mut s = tx.prepare("SELECT name FROM history_groups").map_err(|e| AppError::storage_database(&e))?;
            let rows = s.query_map([], |r| r.get(0)).map_err(|e| AppError::storage_database(&e))?;
            rows.collect::<Result<_,_>>().map_err(|e| AppError::storage_database(&e))?
        };
        if !name.is_empty() && !names.iter().any(|n| n.to_lowercase() == name.to_lowercase()) {
            if names.len() >= 256 { return Err(AppError::new("history_group_limit", "历史分组数量达到本版本的上限（256）。")); }
            tx.execute("INSERT INTO history_groups(id,name,created_at_ms) VALUES(?1,?2,?3)",params![id,name,at])
                .map_err(|e| AppError::storage_database(&e))?;
        }
        tx.commit().map_err(|e| AppError::storage_database(&e))?;
        self.langbai_history_groups()
    }
    pub fn langbai_rename_history_group(&self, id: &str, name: &str) -> Result<Vec<HistoryGroup>, AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let name = group_name(name)?;
        if !name.is_empty() {
            let changed = self.db.execute("UPDATE history_groups SET name=?1 WHERE id=?2",params![name,id])
                .map_err(|e| AppError::storage_database(&e))?;
            if changed != 1 { return Err(AppError::new("history_group_missing", "历史分组不存在。")); }
        }
        self.langbai_history_groups()
    }
    pub fn langbai_delete_history_group(&mut self, id: &str) -> Result<Vec<HistoryGroup>, AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| AppError::storage_database(&e))?;
        // FK removes membership only. History receipts, media, tasks and presets stay intact.
        tx.execute("DELETE FROM history_groups WHERE id=?1",[id]).map_err(|e| AppError::storage_database(&e))?;
        let encoded_id = serde_json::to_string(id).map_err(|_| AppError::invalid())?;
        tx.execute("UPDATE langbai_settings SET payload='\"\"' WHERE key IN ('activeHistoryGroupId','generationGroupId') AND payload=?1",[encoded_id])
            .map_err(|e| AppError::storage_database(&e))?;
        tx.commit().map_err(|e| AppError::storage_database(&e))?;
        self.langbai_history_groups()
    }
    pub fn langbai_set_history_group(&mut self, id: &str, group_id: Option<&str>) -> Result<(), AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let group_id = group_id.filter(|id| !id.is_empty() && *id != "__ungrouped");
        if group_id.is_some_and(|id| !valid_id(id)) { return Err(AppError::invalid()); }
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| AppError::storage_database(&e))?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM history WHERE id=?1)",[id],|r| r.get(0)).map_err(|e| AppError::storage_database(&e))?;
        if !exists { return Err(AppError::new("history_missing", "历史记录不存在。")); }
        if let Some(group) = group_id {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM history_groups WHERE id=?1)",[group],|r| r.get(0)).map_err(|e| AppError::storage_database(&e))?;
            if !exists { return Err(AppError::new("history_group_missing", "历史分组不存在。")); }
            tx.execute("INSERT INTO history_memberships(history_id,group_id) VALUES(?1,?2) ON CONFLICT(history_id) DO UPDATE SET group_id=excluded.group_id",params![id,group]).map_err(|e| AppError::storage_database(&e))?;
        } else { tx.execute("DELETE FROM history_memberships WHERE history_id=?1",[id]).map_err(|e| AppError::storage_database(&e))?; }
        tx.commit().map_err(|e| AppError::storage_database(&e))
    }
    pub fn langbai_history_artifact(&self, id: &str) -> Result<Option<String>, AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        self.db.query_row("SELECT artifact_id FROM history WHERE id=?1",[id],|r| r.get(0)).optional().map_err(|e| AppError::storage_database(&e))
    }
}
fn group_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.chars().count() > 160 || name.chars().any(char::is_control) { return Err(AppError::invalid()); }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, Store) {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("studio.sqlite3")).unwrap();
        (root,store)
    }
    fn add(s: &Store, id: &str, time: i64) {
        s.db.execute("INSERT INTO history(id,created_at_ms,prompt,artifact_id) VALUES(?1,?2,'original',?1)",params![id,time]).unwrap();
    }
    #[test]
    fn paging_is_stable_and_does_not_hide_legacy_receipts() {
        let (_root,s) = store();
        for n in 0..205 { add(&s,&format!("h{n:03}"),123); }
        let a=s.langbai_history_page(&HistoryFilter::default()).unwrap();
        assert_eq!(a.items.len(),100); assert!(a.items[0].request.is_none());
        let b=s.langbai_history_page(&HistoryFilter { before:a.next_cursor,..Default::default() }).unwrap();
        let c=s.langbai_history_page(&HistoryFilter { before:b.next_cursor,..Default::default() }).unwrap();
        assert_eq!(b.items.len(),100); assert_eq!(c.items.len(),5); assert!(c.next_cursor.is_none());
        let ids: std::collections::HashSet<_> = a.items.iter().chain(&b.items).chain(&c.items).map(|h| &h.id).collect();
        assert_eq!(ids.len(),205);
    }
    #[test]
    fn group_edits_persist_and_deletion_only_ungroups_images() {
        let (root,mut s)=store(); add(&s,"image",123);
        s.langbai_create_history_group("g1"," 场景 ",100).unwrap();
        assert_eq!(s.langbai_create_history_group("duplicate","场景",101).unwrap().len(),1);
        s.langbai_set_history_group("image",Some("g1")).unwrap();
        s.langbai_set_setting("activeHistoryGroupId",&serde_json::json!("g1")).unwrap();
        s.langbai_rename_history_group("g1","人物").unwrap(); drop(s);
        let mut s=Store::open(&root.path().join("studio.sqlite3")).unwrap();
        assert_eq!(s.langbai_history_groups().unwrap()[0].name,"人物");
        assert_eq!(s.langbai_history_page(&HistoryFilter { group_id:Some("g1".into()),..Default::default() }).unwrap().items.len(),1);
        s.langbai_delete_history_group("g1").unwrap();
        assert!(s.langbai_history_groups().unwrap().is_empty());
        assert_eq!(s.langbai_settings().unwrap()["activeHistoryGroupId"],"");
        assert_eq!(s.langbai_history_artifact("image").unwrap(),Some("image".into()));
        assert_eq!(s.langbai_history_page(&HistoryFilter { group_id:Some("__ungrouped".into()),..Default::default() }).unwrap().items.len(),1);
    }
    #[test]
    fn filters_and_missing_groups_do_not_mutate_history() {
        let (_root,mut s)=store(); add(&s,"image",123);
        assert!(s.langbai_set_history_group("image",Some("missing")).is_err());
        assert!(s.langbai_create_history_group("g","bad\nname",1).is_err());
        assert!(s.langbai_history_page(&HistoryFilter { from_ms:Some(124),until_ms:Some(123),..Default::default() }).is_err());
        assert_eq!(s.langbai_history_page(&HistoryFilter { from_ms:Some(123),until_ms:Some(124),..Default::default() }).unwrap().items.len(),1);
        assert!(s.langbai_history_page(&HistoryFilter { from_ms:Some(124),until_ms:Some(125),..Default::default() }).unwrap().items.is_empty());
        assert_eq!(s.langbai_history_days().unwrap().len(),1);
    }
    #[test]
    fn v5_migration_preserves_receipts_drafts_and_settings() {
        let (root,s)=store(); add(&s,"legacy",123);
        s.langbai_set_setting("savedStylePrompt",&serde_json::json!("artist:original")).unwrap();
        s.db.execute_batch("DROP TABLE history_memberships; DROP TABLE history_groups; PRAGMA user_version=5;").unwrap(); drop(s);
        let s=Store::open(&root.path().join("studio.sqlite3")).unwrap();
        assert_eq!(s.db.pragma_query_value(None,"user_version",|r| r.get::<_,i64>(0)).unwrap(),6);
        assert_eq!(s.langbai_settings().unwrap()["savedStylePrompt"],"artist:original");
        assert_eq!(s.langbai_history_artifact("legacy").unwrap(),Some("legacy".into()));
    }
}
