use std::{path::Path, time::Duration};
use rusqlite::{params, Connection, OptionalExtension};
use crate::{dto::*, error::AppError, task::TaskState};
#[derive(Debug, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct TaskRecord { pub id:String, pub state:TaskState, pub kind:String, pub created_at_ms:i64, pub acknowledged:bool, pub error_code:Option<String>, pub connection:Option<crate::connections::ConnectionProfile> }
pub struct Store { db: Connection }
impl Store {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| AppError::storage_io(&e))?; }
        // Open the same database without truncation so OS access errors are reported
        // accurately instead of collapsed into SQLite CannotOpen. No alternate path,
        // permission changes, journal deletion or silent in-memory fallback.
        drop(std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(path).map_err(|e| AppError::storage_io(&e))?);
        Self::initialize(Connection::open(path).map_err(|e| AppError::storage_database(&e))?)
    }
    fn initialize(db: Connection) -> Result<Self, AppError> {
        db.busy_timeout(Duration::from_secs(5)).map_err(|e| AppError::storage_database(&e))?;
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(|e| AppError::storage_database(&e))?;
        if version > 5 { return Err(AppError::new("storage_version_unsupported", "数据库版本高于程序支持的版本；未修改数据。")); }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;").map_err(|e| AppError::storage_database(&e))?;
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE editor_draft (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE history (id TEXT PRIMARY KEY, created_at_ms INTEGER NOT NULL, prompt TEXT NOT NULL, artifact_id TEXT NOT NULL);
                CREATE INDEX history_page ON history(created_at_ms DESC, id DESC);
                CREATE TABLE task_journal (id TEXT PRIMARY KEY, state TEXT NOT NULL);
                PRAGMA user_version=1;
                COMMIT;").map_err(|e| AppError::storage_database(&e))?;
        }
        if version <= 1 {
            db.execute_batch("BEGIN IMMEDIATE;
                ALTER TABLE task_journal ADD COLUMN payload TEXT NOT NULL DEFAULT '{}';
                ALTER TABLE task_journal ADD COLUMN kind TEXT NOT NULL DEFAULT 'generation';
                ALTER TABLE task_journal ADD COLUMN created_at_ms INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE task_journal ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE task_journal ADD COLUMN error_code TEXT;
                ALTER TABLE history ADD COLUMN request_json TEXT;
                PRAGMA user_version=2; COMMIT;").map_err(|e| AppError::storage_database(&e))?;
        }
        if version <= 2 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE connections (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE connection_revisions (id TEXT PRIMARY KEY, revision TEXT NOT NULL);
                PRAGMA user_version=3; COMMIT;").map_err(|e| AppError::storage_database(&e))?;
        }
        if version <= 3 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE drawing_presets (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                PRAGMA user_version=4; COMMIT;").map_err(|e| AppError::storage_database(&e))?;
        }
        if version <= 4 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE langbai_settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
                PRAGMA user_version=5; COMMIT;").map_err(|e| AppError::storage_database(&e))?;
        }
        let official = crate::connections::ConnectionProfile::official();
        db.execute("INSERT OR IGNORE INTO connections(id,payload) VALUES(?1,?2)", params![official.id, serde_json::to_string(&official).map_err(|_|AppError::storage())?]).map_err(|e|AppError::storage_database(&e))?;
        Ok(Self { db })
    }
    #[cfg(test)]
    fn memory() -> Self { Self::initialize(Connection::open_in_memory().unwrap()).unwrap() }
    pub fn langbai_settings(&self) -> Result<serde_json::Value, AppError> {
        let mut result = crate::langbai_settings::defaults()?;
        let mut statement = self.db.prepare("SELECT key,payload FROM langbai_settings ORDER BY key")
            .map_err(|error| AppError::storage_database(&error))?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|error| AppError::storage_database(&error))?;
        for row in rows {
            let (key, payload) = row.map_err(|error| AppError::storage_database(&error))?;
            let value = serde_json::from_str(&payload).map_err(|_| AppError::storage())?;
            crate::langbai_settings::validate(&key, &value).map_err(|_| AppError::storage())?;
            result[&key] = value;
        }
        Ok(result)
    }

    pub fn langbai_set_setting(&self, key: &str, value: &serde_json::Value) -> Result<(), AppError> {
        crate::langbai_settings::validate(key, value)?;
        let payload = serde_json::to_string(value).map_err(|_| AppError::invalid())?;
        self.db.execute(
            "INSERT INTO langbai_settings(key,payload) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
            params![key, payload],
        ).map_err(|error| AppError::storage_database(&error))?;
        Ok(())
    }

    pub fn connections(&self) -> Result<Vec<crate::connections::ConnectionProfile>, AppError> {
        let mut statement = self.db.prepare("SELECT payload FROM connections ORDER BY id").map_err(|_|AppError::storage())?;
        let rows = statement.query_map([], |row|row.get::<_,String>(0)).map_err(|_|AppError::storage())?;
        rows.map(|row|serde_json::from_str(&row.map_err(|_|AppError::storage())?).map_err(|_|AppError::storage())).collect()
    }
    pub fn connection(&self,id:&str) -> Result<crate::connections::ConnectionProfile, AppError> {
        let raw: Option<String> = self.db.query_row("SELECT payload FROM connections WHERE id=?1", [id], |row|row.get(0)).optional().map_err(|_|AppError::storage())?;
        serde_json::from_str(&raw.ok_or_else(||AppError::new("connection_missing","连接配置不存在；未发送请求。"))?).map_err(|_|AppError::storage())
    }
    pub fn connection_revision(&self,id:&str)->Result<String,AppError> {
        self.db.query_row("SELECT revision FROM connection_revisions WHERE id=?1",[id],|r|r.get(0)).optional().map_err(|_|AppError::storage()).map(|v|v.unwrap_or_default())
    }
    pub fn rotate_connection_revision(&self,id:&str,revision:&str)->Result<(),AppError> {
        self.connection(id)?;
        self.db.execute("INSERT INTO connection_revisions(id,revision) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",params![id,revision]).map_err(|_|AppError::storage())?;Ok(())
    }
    pub fn save_connection(&mut self,p:&crate::connections::ConnectionProfile) -> Result<(),AppError> {
        p.validate()?;
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|AppError::storage())?;
        let count:i64=tx.query_row("SELECT COUNT(*) FROM connections",[],|r|r.get(0)).map_err(|_|AppError::storage())?;
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM connections WHERE id=?1)",[&p.id],|r|r.get(0)).map_err(|_|AppError::storage())?;
        if count>=32 && !exists {return Err(AppError::new("connection_limit","最多保存 32 套连接配置。"));}
        if p.id==crate::connections::DEFAULT_CONNECTION && p.kind!=crate::connections::ConnectionKind::Official {return Err(AppError::invalid());}
        tx.execute("INSERT INTO connections(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![p.id,serde_json::to_string(p).map_err(|_|AppError::invalid())?]).map_err(|_|AppError::storage())?;
        tx.commit().map_err(|_|AppError::storage())
    }
    pub fn delete_connection(&self,id:&str) -> Result<(),AppError> {
        if id==crate::connections::DEFAULT_CONNECTION {return Err(AppError::new("default_connection","默认账号可修改名称或删除凭据，但不能删除配置。"));}
        self.db.execute("DELETE FROM connections WHERE id=?1",[id]).map_err(|_|AppError::storage())?;Ok(())
    }
    pub fn drawing_presets(&self) -> Result<Vec<crate::presets::DrawingPreset>, AppError> {
        let mut statement = self.db.prepare("SELECT payload FROM drawing_presets ORDER BY id").map_err(|_|AppError::storage())?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|_|AppError::storage())?;
        rows.map(|row| {
            let preset: crate::presets::DrawingPreset = serde_json::from_str(&row.map_err(|_|AppError::storage())?).map_err(|_|AppError::storage())?;
            preset.validate().map_err(|_|AppError::storage())?;
            Ok(preset)
        }).collect()
    }
    pub fn save_drawing_preset(&mut self, preset: &crate::presets::DrawingPreset) -> Result<(), AppError> {
        preset.validate()?;
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|AppError::storage())?;
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM drawing_presets", [], |r|r.get(0)).map_err(|_|AppError::storage())?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM drawing_presets WHERE id=?1)", [&preset.id], |r|r.get(0)).map_err(|_|AppError::storage())?;
        if count >= 32 && !exists { return Err(AppError::new("preset_limit", "最多保存 32 套绘图配置。")); }
        tx.execute("INSERT INTO drawing_presets(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![preset.id, serde_json::to_string(preset).map_err(|_|AppError::invalid())?]).map_err(|_|AppError::storage())?;
        tx.commit().map_err(|_|AppError::storage())
    }
    pub fn delete_drawing_preset(&self, id: &str) -> Result<(), AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        self.db.execute("DELETE FROM drawing_presets WHERE id=?1", [id]).map_err(|_|AppError::storage())?;
        Ok(())
    }
    pub fn load_draft(&self) -> Result<EditorDraft, AppError> {
        let raw: Option<String> = self.db.query_row("SELECT payload FROM editor_draft WHERE id=1", [], |row| row.get(0)).optional().map_err(|_| AppError::storage())?;
        let draft = match raw { None => EditorDraft::default(), Some(raw) => serde_json::from_str::<EditorDraft>(&raw).map_err(|_| AppError::storage())? };
        draft.validate().map_err(|_| AppError::storage())?;
        Ok(draft)
    }
    pub fn save_draft(&self, draft: &EditorDraft) -> Result<(), AppError> {
        draft.validate()?;
        let json = serde_json::to_string(draft).map_err(|_| AppError::invalid())?;
        self.db.execute("INSERT INTO editor_draft(id,payload) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", [json]).map_err(|_| AppError::storage())?;
        Ok(())
    }
    pub fn list_history(&self, query: &HistoryQuery) -> Result<HistoryPage, AppError> {
        let limit = query.page_size()?;
        let (time, id) = query.before.as_ref().map(|c| (c.created_at_ms, c.id.as_str())).unwrap_or((i64::MAX, ""));
        let mut stmt = self.db.prepare("SELECT id,created_at_ms,prompt,artifact_id FROM history
            WHERE (?1 IS NULL OR created_at_ms < ?2 OR (created_at_ms=?2 AND id < ?3))
            ORDER BY created_at_ms DESC,id DESC LIMIT ?4").map_err(|_| AppError::storage())?;
        let rows = stmt.query_map(params![query.before.as_ref().map(|_| 1),time,id,limit+1], |row| Ok(HistoryItem { id: row.get(0)?, created_at_ms: row.get(1)?, prompt: row.get(2)?, artifact_id: row.get(3)? })).map_err(|_| AppError::storage())?;
        let mut items = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|_| AppError::storage())?;
        let more = items.len() > limit as usize;
        items.truncate(limit as usize);
        let next_cursor = if more { items.last().map(|i| HistoryCursor { created_at_ms: i.created_at_ms, id: i.id.clone() }) } else { None };
        Ok(HistoryPage { items, next_cursor })
    }
    pub fn insert_history(&self, item: &HistoryItem) -> Result<(), AppError> {
        if !valid_id(&item.id) || !valid_id(&item.artifact_id) || item.created_at_ms < 0 || item.prompt.len() > 131_072 { return Err(AppError::invalid()); }
        self.db.execute("INSERT INTO history(id,created_at_ms,prompt,artifact_id) VALUES(?1,?2,?3,?4)", params![item.id,item.created_at_ms,item.prompt,item.artifact_id]).map_err(|_| AppError::storage())?;
        Ok(())
    }
    pub fn queue_task(&self, id: &str) -> Result<(), AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let state = serde_json::to_string(&TaskState::Queued).map_err(|_| AppError::storage())?;
        self.db.execute("INSERT INTO task_journal(id,state) VALUES(?1,?2)", params![id,state]).map_err(|_| AppError::storage())?;
        Ok(())
    }
    pub fn task_state(&self, id: &str) -> Result<TaskState, AppError> {
        let raw: String = self.db.query_row("SELECT state FROM task_journal WHERE id=?1", [id], |row| row.get(0)).map_err(|_| AppError::storage())?;
        serde_json::from_str(&raw).map_err(|_| AppError::storage())
    }
    pub fn transition_task(&mut self, id: &str, next: TaskState) -> Result<(), AppError> {
        let tx = self.db.transaction().map_err(|_| AppError::storage())?;
        let raw: String = tx.query_row("SELECT state FROM task_journal WHERE id=?1", [id], |row| row.get(0)).map_err(|_| AppError::storage())?;
        let current: TaskState = serde_json::from_str(&raw).map_err(|_| AppError::storage())?;
        current.transition(next)?;
        let next = serde_json::to_string(&next).map_err(|_| AppError::storage())?;
        tx.execute("UPDATE task_journal SET state=?1 WHERE id=?2", params![next,id]).map_err(|_| AppError::storage())?;
        tx.commit().map_err(|_| AppError::storage())
    }
    pub fn recover_uncertain_tasks(&self) -> Result<usize, AppError> {
        let submitting = serde_json::to_string(&TaskState::Submitting).map_err(|_| AppError::storage())?;
        let running = serde_json::to_string(&TaskState::Running).map_err(|_| AppError::storage())?;
        let unknown = serde_json::to_string(&TaskState::OutcomeUnknown).map_err(|_| AppError::storage())?;
        self.db.execute("UPDATE task_journal SET state=?1 WHERE state IN (?2,?3)", params![unknown,submitting,running]).map_err(|_| AppError::storage())
    }
    pub fn preflight_remote(&mut self) -> Result<(), AppError> {
        // Verify the existing journal can acquire a write transaction without
        // recording a submission or changing its identity. begin_remote_task
        // still repeats the unresolved check atomically before the real POST.
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_| AppError::storage())?;
        // BEGIN alone can succeed on a read-only WAL connection. A no-row
        // write also verifies SQLite's write permissions, then rolls back.
        tx.execute("UPDATE task_journal SET acknowledged=acknowledged WHERE 0", []).map_err(|_| AppError::storage())?;
        let active = [TaskState::Submitting, TaskState::Running, TaskState::OutcomeUnknown].map(|s|serde_json::to_string(&s).unwrap());
        let unresolved: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM task_journal WHERE state IN (?1,?2,?3) AND acknowledged=0)",params![active[0],active[1],active[2]],|r|r.get(0)).map_err(|_| AppError::storage())?;
        tx.rollback().map_err(|_| AppError::storage())?;
        if unresolved { return Err(AppError::new("outcome_unresolved", "存在未核对的付费任务；请先查看任务记录并核对所选服务的任务结果及费用。")); }
        Ok(())
    }
    pub fn begin_remote_task(&mut self, id: &str, kind: &str, payload: &str, at: i64) -> Result<(), AppError> {
        if !valid_id(id) || !["generation", "vibe_encoding"].contains(&kind) || payload.len() > 262_144 { return Err(AppError::invalid()); }
        // Check and durable insert share an IMMEDIATE transaction. Separate app
        // connections cannot both pass the unresolved-task check concurrently.
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_| AppError::storage())?;
        let active = [TaskState::Submitting, TaskState::Running, TaskState::OutcomeUnknown].map(|s|serde_json::to_string(&s).unwrap());
        let unresolved: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM task_journal WHERE state IN (?1,?2,?3) AND acknowledged=0)",params![active[0],active[1],active[2]],|r|r.get(0)).map_err(|_| AppError::storage())?;
        if unresolved { return Err(AppError::new("outcome_unresolved", "存在未核对的付费任务；请先查看任务记录并核对所选服务的任务结果及费用。")); }
        tx.execute("INSERT INTO task_journal(id,state,payload,kind,created_at_ms) VALUES(?1,?2,?3,?4,?5)",
            params![id, serde_json::to_string(&TaskState::Submitting).unwrap(), payload, kind, at]).map_err(|_| AppError::storage())?;
        tx.commit().map_err(|_| AppError::storage())
    }
    pub fn has_unresolved(&self) -> Result<bool, AppError> {
        let active=[TaskState::Submitting,TaskState::Running,TaskState::OutcomeUnknown].map(|s|serde_json::to_string(&s).unwrap());
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM task_journal WHERE state IN (?1,?2,?3) AND acknowledged=0)", params![active[0],active[1],active[2]], |r| r.get(0)).map_err(|_| AppError::storage())
    }
    pub fn record_unknown(&mut self, id: &str, code: &str) -> Result<(), AppError> {
        let tx = self.db.transaction().map_err(|_| AppError::storage())?;
        tx.execute("UPDATE task_journal SET state=?1,error_code=?2 WHERE id=?3 AND state IN (?4,?5)", params![serde_json::to_string(&TaskState::OutcomeUnknown).unwrap(),code,id,serde_json::to_string(&TaskState::Submitting).unwrap(),serde_json::to_string(&TaskState::Running).unwrap()]).map_err(|_| AppError::storage())?;
        tx.commit().map_err(|_| AppError::storage())
    }
    pub fn finish_remote_task(&mut self, id: &str, history: Option<&HistoryItem>, snapshot: Option<&str>) -> Result<(), AppError> {
        let tx = self.db.transaction().map_err(|_| AppError::storage())?;
        let changed=tx.execute("UPDATE task_journal SET state=?1 WHERE id=?2 AND state IN (?3,?4)", params![serde_json::to_string(&TaskState::Completed).unwrap(),id,serde_json::to_string(&TaskState::Submitting).unwrap(),serde_json::to_string(&TaskState::Running).unwrap()]).map_err(|_| AppError::storage())?;
        if changed != 1 { return Err(AppError::storage()); }
        if let Some(h) = history {
            tx.execute("INSERT INTO history(id,created_at_ms,prompt,artifact_id,request_json) VALUES(?1,?2,?3,?4,?5)",params![h.id,h.created_at_ms,h.prompt,h.artifact_id,snapshot]).map_err(|_| AppError::storage())?;
        }
        tx.commit().map_err(|_| AppError::storage())
    }
    pub fn task_list(&self) -> Result<Vec<TaskRecord>, AppError> {
        let mut stmt=self.db.prepare("SELECT id,state,kind,created_at_ms,acknowledged,error_code,payload FROM task_journal ORDER BY created_at_ms DESC,id DESC LIMIT 30").map_err(|_| AppError::storage())?;
        let rows=stmt.query_map([],|r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,bool>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?))).map_err(|_| AppError::storage())?;
        rows.map(|row|{let(id,state,kind,created_at_ms,acknowledged,error_code,payload)=row.map_err(|_| AppError::storage())?;let value:serde_json::Value=serde_json::from_str(&payload).map_err(|_|AppError::storage())?;let connection=value.get("connection").map(|v|serde_json::from_value(v.clone()).map_err(|_|AppError::storage())).transpose()?;Ok(TaskRecord{id,state:serde_json::from_str(&state).map_err(|_| AppError::storage())?,kind,created_at_ms,acknowledged,error_code,connection})}).collect()
    }
    pub fn acknowledge_unknown(&self, id: &str) -> Result<(), AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let changed=self.db.execute("UPDATE task_journal SET acknowledged=1 WHERE id=?1 AND state=?2",params![id,serde_json::to_string(&TaskState::OutcomeUnknown).unwrap()]).map_err(|_| AppError::storage())?;
        if changed != 1 {return Err(AppError::invalid());} Ok(())
    }
    pub fn history_request(&self, id: &str) -> Result<crate::generation::GenerationInput, AppError> {
        if !valid_id(id) { return Err(AppError::invalid()); }
        let json: Option<String> = self.db.query_row("SELECT request_json FROM history WHERE id=?1",[id],|r|r.get(0)).map_err(|_| AppError::storage())?;
        let mut input:crate::generation::GenerationInput=serde_json::from_str(&json.ok_or_else(AppError::invalid)?).map_err(|_| AppError::storage())?;
        input.confirm_paid=false; Ok(input)
    }

}
#[cfg(test)]
mod tests {
    #[test]
    fn preflight_does_not_create_or_acknowledge_tasks() {
        let mut s = Store::memory();
        s.preflight_remote().unwrap();
        assert!(s.task_list().unwrap().is_empty());
        s.begin_remote_task("preflight-task", "generation", "{}", 1).unwrap();
        assert_eq!(s.preflight_remote().unwrap_err().code, "outcome_unresolved");
        assert!(!s.task_list().unwrap()[0].acknowledged);
    }
    #[test]
    fn preflight_rejects_read_only_database() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("read-only.sqlite3");
        drop(Store::open(&path).unwrap());
        let db = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut s = Store { db };
        assert_eq!(s.preflight_remote().unwrap_err().code, "storage_unavailable");
    }

    use super::*;
    #[test]
    fn draft_round_trip_and_oversized_rejection() {
        let store = Store::memory();
        let draft = EditorDraft { prompt: "测试 prompt".into(), negative_prompt: "排除内容".into(), prompt_document: None };
        store.save_draft(&draft).unwrap();
        assert_eq!(store.load_draft().unwrap(), draft);
        assert!(store.save_draft(&EditorDraft { prompt: "x".repeat(131_073), ..draft.clone() }).is_err());
        assert_eq!(store.load_draft().unwrap(), draft);
    }
    #[test]
    fn pagination_handles_tied_timestamps() {
        let store = Store::memory();
        for id in ["a", "b", "c"] { store.insert_history(&HistoryItem { id: id.into(), created_at_ms: 10, prompt: "p".into(), artifact_id: id.into() }).unwrap(); }
        let first = store.list_history(&HistoryQuery { limit: Some(2), before: None }).unwrap();
        assert_eq!(first.items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["c", "b"]);
        let second = store.list_history(&HistoryQuery { limit: Some(2), before: first.next_cursor }).unwrap();
        assert_eq!(second.items[0].id, "a"); assert!(second.next_cursor.is_none());
        assert!(store.list_history(&HistoryQuery { limit: Some(101), before: None }).is_err());
    }
    #[test]
    fn recovery_does_not_requeue_paid_requests() {
        let mut store = Store::memory(); store.queue_task("task-1").unwrap();
        store.transition_task("task-1", TaskState::Submitting).unwrap();
        assert_eq!(store.recover_uncertain_tasks().unwrap(), 1);
        assert_eq!(store.task_state("task-1").unwrap(), TaskState::OutcomeUnknown);
        assert!(store.transition_task("task-1", TaskState::Queued).is_err());
        assert_eq!(store.recover_uncertain_tasks().unwrap(), 0);
    }
    #[test]
    fn submitted_journal_survives_reopen_as_unknown() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("pc-core-test-{}-{stamp}.sqlite3", std::process::id()));
        {
            let mut store = Store::open(&path).unwrap();
            store.queue_task("task-durable").unwrap();
            store.transition_task("task-durable", TaskState::Submitting).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.task_state("task-durable").unwrap(), TaskState::Submitting);
            assert_eq!(store.recover_uncertain_tasks().unwrap(), 1);
            assert_eq!(store.task_state("task-durable").unwrap(), TaskState::OutcomeUnknown);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn separate_connections_cannot_begin_two_unresolved_paid_tasks() {
        use std::sync::{Arc,Barrier};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path=std::env::temp_dir().join(format!("pc-journal-race-{}-{stamp}.sqlite3",std::process::id()));
        drop(Store::open(&path).unwrap());
        let a=Store::open(&path).unwrap();let b=Store::open(&path).unwrap();
        let barrier=Arc::new(Barrier::new(2));
        let handles=[a,b].into_iter().enumerate().map(|(index,mut store)|{let barrier=barrier.clone();std::thread::spawn(move||{barrier.wait();store.begin_remote_task(&format!("race-{index}"),"generation","{}",1).map_err(|e|e.code)})}).collect::<Vec<_>>();
        let results=handles.into_iter().map(|h|h.join().unwrap()).collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|r|r.is_ok()).count(),1);
        assert!(results.contains(&Err("outcome_unresolved")));
        {let store=Store::open(&path).unwrap();assert_eq!(store.task_list().unwrap().len(),1);}
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn future_schema_not_downgraded() {
        let db = Connection::open_in_memory().unwrap(); db.execute_batch("PRAGMA user_version=999;").unwrap();
        assert!(matches!(Store::initialize(db), Err(e) if e.code == "storage_version_unsupported"));
    }
    #[test]
    fn dto_rejects_credentials() {
        assert!(serde_json::from_str::<EditorDraft>(r#"{"prompt":"p","negativePrompt":"","token":"secret"}"#).is_err());
    }
}

#[cfg(test)] mod connection_tests {
    use super::*;
    use crate::connections::*;
    #[test] fn metadata_roundtrip_is_bounded_and_retains_default() {
        let mut s=Store::memory();
        assert_eq!(s.connections().unwrap(),vec![ConnectionProfile::official()]);
        let mut profile=ConnectionProfile::official();profile.id="account-b".into();profile.name="账号 B".into();
        s.save_connection(&profile).unwrap();assert_eq!(s.connection("account-b").unwrap(),profile);
        s.delete_connection("account-b").unwrap();assert_eq!(s.connections().unwrap().len(),1);
        assert_eq!(s.delete_connection(DEFAULT_CONNECTION).unwrap_err().code,"default_connection");
    }
    #[test] fn v2_migration_preserves_draft_and_unresolved_journal() {
        let d=tempfile::tempdir().unwrap();let path=d.path().join("existing.sqlite3");
        let db=Connection::open(&path).unwrap();
        db.execute_batch(r#"CREATE TABLE editor_draft(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
          CREATE TABLE history(id TEXT PRIMARY KEY,created_at_ms INTEGER,prompt TEXT,artifact_id TEXT,request_json TEXT);
          CREATE TABLE task_journal(id TEXT PRIMARY KEY,state TEXT,payload TEXT,kind TEXT,created_at_ms INTEGER,acknowledged INTEGER,error_code TEXT);
          INSERT INTO editor_draft VALUES(1,'{"prompt":"old draft","negativePrompt":""}');
          INSERT INTO task_journal VALUES('old-task','"submitting"','{}','generation',1,0,NULL);
          PRAGMA user_version=2;"#).unwrap();drop(db);
        let s=Store::open(&path).unwrap();assert_eq!(s.load_draft().unwrap().prompt,"old draft");
        assert!(s.has_unresolved().unwrap());assert_eq!(s.connections().unwrap().len(),1);
    }
    #[test] fn metadata_rejects_unknown_secret_fields() {
        let mut v=serde_json::to_value(ConnectionProfile::official()).unwrap();v["token"]=serde_json::json!("test-only");
        assert!(serde_json::from_value::<ConnectionProfile>(v).is_err());
    }
}

#[cfg(test)] mod connection_limit_tests {
    use super::*;
    #[test] fn profile_limit_rejects_insert_not_update_and_revision_is_durable() {
        let mut s=Store::memory();
        for n in 1..32 {let mut p=crate::connections::ConnectionProfile::official();p.id=format!("account-{n}");s.save_connection(&p).unwrap();}
        let mut p=crate::connections::ConnectionProfile::official();p.id="account-overflow".into();assert_eq!(s.save_connection(&p).unwrap_err().code,"connection_limit");
        p.id="account-1".into();p.name="updated".into();s.save_connection(&p).unwrap();
        assert_eq!(s.connection_revision("account-1").unwrap(),"");
        s.rotate_connection_revision("account-1","test-revision").unwrap();assert_eq!(s.connection_revision("account-1").unwrap(),"test-revision");
    }
}

#[cfg(test)] mod drawing_preset_tests {
    use super::*;
    use crate::presets::DrawingPreset;
    fn preset() -> DrawingPreset {
        DrawingPreset { id:"preset-1".into(), name:"portrait".into(), draft:EditorDraft{prompt:"subject".into(),negative_prompt:"".into(),prompt_document:None},
          model:"nai-diffusion-4-5-full".into(),width:832,height:1216,steps:23,guidance:5.0,sampler:"k_euler_ancestral".into(),seed:None,strength:0.7,noise:0.0 }
    }
    #[test] fn round_trip_and_bounds() {
        let mut s=Store::memory(); let mut p=preset();
        s.save_drawing_preset(&p).unwrap(); assert_eq!(s.drawing_presets().unwrap()[0].draft.prompt,"subject");
        p.width=1536; p.height=1536; assert!(s.save_drawing_preset(&p).is_err());
        assert_eq!(s.drawing_presets().unwrap()[0].width,832);
        s.delete_drawing_preset(&p.id).unwrap(); assert!(s.drawing_presets().unwrap().is_empty());
    }
    #[test] fn secret_and_transient_fields_rejected() {
        for field in ["token","connectionId","imageId","vibes","confirmPaid"] {
            let mut v=serde_json::to_value(preset()).unwrap();v[field]=serde_json::json!("not-allowed");
            assert!(serde_json::from_value::<DrawingPreset>(v).is_err());
        }
    }
    #[test] fn limit_allows_updates_not_new_entries() {
        let mut s=Store::memory();let mut p=preset();
        for n in 0..32 {p.id=format!("preset-{n}");s.save_drawing_preset(&p).unwrap();}
        p.name="updated".into();s.save_drawing_preset(&p).unwrap();
        p.id="overflow".into();assert_eq!(s.save_drawing_preset(&p).unwrap_err().code,"preset_limit");
    }
    #[test] fn v3_migration_preserves_accounts_draft_and_journal() {
        let d=tempfile::tempdir().unwrap();let path=d.path().join("existing.sqlite3");
        {let s=Store::open(&path).unwrap();s.save_draft(&preset().draft).unwrap();s.db.execute_batch("DROP TABLE drawing_presets; DROP TABLE langbai_settings; PRAGMA user_version=3;").unwrap();
         s.db.execute(r#"INSERT INTO task_journal(id,state,payload,kind,created_at_ms,acknowledged) VALUES('pending','"submitting"','{}','generation',1,0)"#,[]).unwrap();}
        let s=Store::open(&path).unwrap();assert_eq!(s.load_draft().unwrap().prompt,"subject");assert!(s.has_unresolved().unwrap());
        assert_eq!(s.connections().unwrap().len(),1);assert!(s.drawing_presets().unwrap().is_empty());
    }
}

#[cfg(test)]
mod open_safety_tests {
    use super::*;
    #[test]
    fn invalid_database_is_preserved_without_reset_or_fallback() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("studio.sqlite3");
        let original = b"not a database; retain this data";
        std::fs::write(&path, original).unwrap();
        assert_eq!(Store::open(&path).err().unwrap().code, "storage_corrupt");
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }
}

#[cfg(test)] mod langbai_settings_tests {
    use super::*;
    use serde_json::json;
    #[test] fn sparse_settings_round_trip_preserves_other_defaults() {
        let s=Store::memory(); let before=s.langbai_settings().unwrap();
        s.langbai_set_setting("theme",&json!("dark")).unwrap();
        s.langbai_set_setting("savedStylePrompt",&json!("artist:example")).unwrap();
        let after=s.langbai_settings().unwrap(); assert_eq!(after["theme"],"dark");
        assert_eq!(after["savedStylePrompt"],"artist:example"); assert_eq!(after["language"],before["language"]);
        assert!(s.langbai_set_setting("theme",&json!(23)).is_err()); assert_eq!(s.langbai_settings().unwrap()["theme"],"dark");
    }
    #[test]
    fn v4_migration_preserves_draft_history_connections_presets_and_unresolved_tasks() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.sqlite3");
        let draft = EditorDraft { prompt: "retained".into(), negative_prompt: "".into(), prompt_document: None };
        let preset = crate::presets::DrawingPreset {
            id: "preserved-preset".into(), name: "Preserved".into(), draft: draft.clone(),
            model: "nai-diffusion-4-5-full".into(), width: 832, height: 1216,
            steps: 23, guidance: 5.0, sampler: "k_euler_ancestral".into(),
            seed: Some(42), strength: 0.7, noise: 0.0,
        };
        let mut account = crate::connections::ConnectionProfile::official();
        account.id = "preserved-account".into();
        account.name = "Preserved account".into();
        {
            let mut store = Store::open(&path).unwrap();
            store.save_draft(&draft).unwrap();
            store.save_connection(&account).unwrap();
            store.rotate_connection_revision(&account.id, "preserved-revision").unwrap();
            store.save_drawing_preset(&preset).unwrap();
            store.insert_history(&HistoryItem {
                id: "preserved-history".into(), created_at_ms: 1,
                prompt: "retained history".into(), artifact_id: "preserved-image".into(),
            }).unwrap();
            store.db.execute_batch("DROP TABLE langbai_settings; PRAGMA user_version=4;").unwrap();
            store.db.execute(r#"INSERT INTO task_journal(id,state,payload,kind,created_at_ms,acknowledged) VALUES('pending','"submitting"','{}','generation',1,0)"#, []).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.load_draft().unwrap(), draft);
        assert_eq!(store.connections().unwrap().len(), 2);
        assert_eq!(store.connection(&account.id).unwrap(), account);
        assert_eq!(store.connection_revision(&account.id).unwrap(), "preserved-revision");
        assert!(store.has_unresolved().unwrap());
        assert_eq!(serde_json::to_value(&store.drawing_presets().unwrap()[0]).unwrap(), serde_json::to_value(&preset).unwrap());
        let history = store.list_history(&HistoryQuery { limit: Some(10), before: None }).unwrap();
        assert_eq!(history.items[0].id, "preserved-history");
        assert_eq!(history.items[0].artifact_id, "preserved-image");
        assert_eq!(history.items[0].prompt, "retained history");
        assert_eq!(store.langbai_settings().unwrap()["theme"], "light");
        store.langbai_set_setting("savedStylePrompt", &json!("retained artist")).unwrap();
        drop(store);
        assert_eq!(Store::open(&path).unwrap().langbai_settings().unwrap()["savedStylePrompt"], "retained artist");
    }
    #[test] fn corrupt_setting_is_not_overwritten_with_defaults() {
        let s=Store::memory(); s.db.execute("INSERT INTO langbai_settings(key,payload) VALUES('theme','false')",[]).unwrap();
        assert_eq!(s.langbai_settings().unwrap_err().code,"storage_unavailable");
        let raw:String=s.db.query_row("SELECT payload FROM langbai_settings WHERE key='theme'",[],|r|r.get(0)).unwrap(); assert_eq!(raw,"false");
    }
}
