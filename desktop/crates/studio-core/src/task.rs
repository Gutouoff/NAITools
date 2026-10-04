use serde::{Deserialize, Serialize};
use crate::error::AppError;
// LOCAL journal states, not NovelAI fields or guarantees of remote idempotency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState { Queued, Submitting, Running, Completed, Failed, Cancelled, OutcomeUnknown }
impl TaskState {
    pub fn can_transition_to(self, next: Self) -> bool {
        use TaskState::*;
        matches!((self, next), (Queued, Submitting | Cancelled | Failed) |
            (Submitting, Running | Completed | OutcomeUnknown) | (Running, Completed | OutcomeUnknown))
        // No proven-rejection evidence API yet: never claim cancellation after submission.
    }
    pub fn transition(self, next: Self) -> Result<Self, AppError> {
        if self.can_transition_to(next) { Ok(next) }
        else { Err(AppError::new("invalid_task_transition", "任务状态不允许此操作。")) }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uncertainty_never_retries_or_claims_cancellation() {
        assert!(TaskState::Submitting.transition(TaskState::OutcomeUnknown).is_ok());
        assert!(TaskState::Submitting.transition(TaskState::Cancelled).is_err());
        assert!(TaskState::Running.transition(TaskState::Failed).is_err());
        assert!(TaskState::OutcomeUnknown.transition(TaskState::Queued).is_err());
        assert!(TaskState::Completed.transition(TaskState::Submitting).is_err());
    }
}
