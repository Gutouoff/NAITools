use studio_core::dto::{EditorDraft, HistoryPage, HistoryQuery};
#[test]
fn local_ipc_fixture_round_trips_without_field_drift() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../contracts/ipc-v1.fixture.json")).unwrap();
    let draft: EditorDraft = serde_json::from_value(fixture["draft"].clone()).unwrap();
    draft.validate().unwrap();
    assert_eq!(serde_json::to_value(draft).unwrap(), fixture["draft"]);
    let query: HistoryQuery = serde_json::from_value(fixture["historyQuery"].clone()).unwrap();
    assert_eq!(query.page_size().unwrap(), 50);
    assert_eq!(serde_json::to_value(query).unwrap(), fixture["historyQuery"]);
    let page: HistoryPage = serde_json::from_value(fixture["emptyHistoryPage"].clone()).unwrap();
    assert_eq!(serde_json::to_value(page).unwrap(), fixture["emptyHistoryPage"]);
}
