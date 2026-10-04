use std::{path::Path, time::Duration};
use rusqlite::{params, Connection, OptionalExtension};
use crate::{dto::*, error::AppError, task::TaskState};
#[derive(Debug, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct TaskRecord { pub id:String, pub state:TaskState, pub kind:String, pub created_at_ms:i64, pub acknowledged:bool, pub error_code:Option<String> }
pub struct Store { db: Connection }
impl Store {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|_| AppError::storage())?; }
        Self::initialize(Connection::open(path).map_err(|_| AppError::storage())?)
    }
    fn initialize(db: Connection) -> Result<Self, AppError> {
        db.busy_timeout(Duration::from_secs(5)).map_err(|_| AppError::storage())?;
        let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(|_| AppError::storage())?;
        if version > 2 { return Err(AppError::new("storage_version_unsupported", "数据库版本高于程序支持的版本；未修改数据。")); }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;").map_err(|_| AppError::storage())?;
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE editor_draft (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE history (id TEXT PRIMARY KEY, created_at_ms INTEGER NOT NULL, prompt TEXT NOT NULL, artifact_id TEXT NOT NULL);
                CREATE INDEX history_page ON history(created_at_ms DESC, id DESC);
                CREATE TABLE task_journal (id TEXT PRIMARY KEY, state TEXT NOT NULL);
                PRAGMA user_version=1;
                COMMIT;").map_err(|_| AppError::storage())?;
        }
        if version <= 1 {
            db.execute_batch("BEGIN IMMEDIATE;
                ALTER TABLE task_journal ADD COLUMN payload TEXT NOT NULL DEFAULT '{}';
                ALTER TABLE task_journal ADD COLUMN kind TEXT NOT NULL DEFAULT 'generation';
                ALTER TABLE task_journal ADD COLUMN created_at_ms INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE task_journal ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE task_journal ADD COLUMN error_code TEXT;
                ALTER TABLE history ADD COLUMN request_json TEXT;
                PRAGMA user_version=2; COMMIT;").map_err(|_| AppError::storage())?;
        }
        Ok(Self { db })
    }
    #[cfg(test)]
    fn memory() -> Self { Self::initialize(Connection::open_in_memory().unwrap()).unwrap() }
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
        if unresolved { return Err(AppError::new("outcome_unresolved", "存在未核对的付费任务；请先查看任务记录并核对官网。")); }
        Ok(())
    }
    pub fn begin_remote_task(&mut self, id: &str, kind: &str, payload: &str, at: i64) -> Result<(), AppError> {
        if !valid_id(id) || !["generation", "vibe_encoding"].contains(&kind) || payload.len() > 262_144 { return Err(AppError::invalid()); }
        // Check and durable insert share an IMMEDIATE transaction. Separate app
        // connections cannot both pass the unresolved-task check concurrently.
        let tx = self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_| AppError::storage())?;
        let active = [TaskState::Submitting, TaskState::Running, TaskState::OutcomeUnknown].map(|s|serde_json::to_string(&s).unwrap());
        let unresolved: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM task_journal WHERE state IN (?1,?2,?3) AND acknowledged=0)",params![active[0],active[1],active[2]],|r|r.get(0)).map_err(|_| AppError::storage())?;
        if unresolved { return Err(AppError::new("outcome_unresolved", "存在未核对的付费任务；请先查看任务记录并核对官网。")); }
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
        let mut stmt=self.db.prepare("SELECT id,state,kind,created_at_ms,acknowledged,error_code FROM task_journal ORDER BY created_at_ms DESC,id DESC LIMIT 30").map_err(|_| AppError::storage())?;
        let rows=stmt.query_map([],|r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,bool>(4)?,r.get::<_,Option<String>>(5)?))).map_err(|_| AppError::storage())?;
        rows.map(|row|{let(id,state,kind,created_at_ms,acknowledged,error_code)=row.map_err(|_| AppError::storage())?;Ok(TaskRecord{id,state:serde_json::from_str(&state).map_err(|_| AppError::storage())?,kind,created_at_ms,acknowledged,error_code})}).collect()
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
