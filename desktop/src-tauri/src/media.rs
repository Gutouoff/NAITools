//! Original image delivery without bulk base64 history responses. A bounded worker
//! queue keep file reads off the UI thread without per-image threads.
use crate::Runtime;
use std::{
    io::Read,
    path::Path,
    sync::{
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
};
use studio_core::dto::valid_id;
use tauri::{
    http::{Request, Response, StatusCode},
    Manager, UriSchemeContext, UriSchemeResponder, Wry,
};

struct Job {
    runtime: Arc<Runtime>,
    id: String,
    responder: UriSchemeResponder,
}
pub struct MediaServer {
    queue: SyncSender<Job>,
}
impl MediaServer {
    pub fn new() -> Self {
        let (queue, receiver) = mpsc::sync_channel::<Job>(64);
        let receiver = Arc::new(Mutex::new(receiver));
        for _ in 0..1 {
            let receiver = receiver.clone();
            std::thread::spawn(move || loop {
                let job = match receiver.lock() {
                    Ok(r) => r.recv(),
                    Err(_) => break,
                };
                let Ok(job) = job else {
                    break;
                };
                let response = match owned_media(&job.runtime.service.root, &job.id) {
                    Ok((bytes, mime)) => response_with_type(StatusCode::OK, bytes, mime),
                    Err(status) => response(status, Vec::new()),
                };
                job.responder.respond(response);
            });
        }
        Self { queue }
    }
    pub fn handle(
        &self,
        context: UriSchemeContext<'_, Wry>,
        request: Request<Vec<u8>>,
        responder: UriSchemeResponder,
    ) {
        if context.webview_label() != "main" {
            responder.respond(response(StatusCode::FORBIDDEN, Vec::new()));
            return;
        }
        let id = match request_id(&request) {
            Ok(id) => id.to_owned(),
            Err(status) => {
                responder.respond(response(status, Vec::new()));
                return;
            }
        };
        let Some(runtime) = context.app_handle().try_state::<Arc<Runtime>>() else {
            responder.respond(response(StatusCode::SERVICE_UNAVAILABLE, Vec::new()));
            return;
        };
        if let Err(error) = self.queue.try_send(Job {
            runtime: runtime.inner().clone(),
            id,
            responder,
        }) {
            let job = match error {
                mpsc::TrySendError::Full(j) | mpsc::TrySendError::Disconnected(j) => j,
            };
            job.responder
                .respond(response(StatusCode::SERVICE_UNAVAILABLE, Vec::new()));
        }
    }
}
fn request_id(request: &Request<Vec<u8>>) -> Result<&str, StatusCode> {
    if request.method() != "GET" {
        return Err(StatusCode::METHOD_NOT_ALLOWED);
    }
    let uri = request.uri();
    // Windows maps this registered protocol to the exact .localhost origin.
    if !matches!(
        (uri.scheme_str(), uri.authority().map(|a| a.as_str())),
        (Some("http"), Some("naitools-image.localhost"))
            | (Some("naitools-image"), Some("localhost"))
    ) || uri.query().is_some()
        || !request.body().is_empty()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let id = uri
        .path()
        .strip_prefix('/')
        .filter(|id| valid_media_id(id))
        .ok_or(StatusCode::BAD_REQUEST)?;
    Ok(id)
}
fn valid_media_id(value: &str) -> bool {
    if valid_id(value) {
        return true;
    }
    let Some(file) = value.strip_prefix("imports/") else {
        return false;
    };
    let Some((id, ext)) = file.rsplit_once('.') else {
        return false;
    };
    valid_id(id) && matches!(ext, "png" | "jpg" | "webp")
}
fn response(status: StatusCode, bytes: Vec<u8>) -> Response<Vec<u8>> {
    response_with_type(status, bytes, "image/png")
}
fn response_with_type(status: StatusCode, bytes: Vec<u8>, mime: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(bytes)
        .expect("constant response headers")
}
fn owned_media(root: &Path, value: &str) -> Result<(Vec<u8>, &'static str), StatusCode> {
    if !valid_media_id(value) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if value.starts_with("imports/") {
        return studio_nai::local_images::media_bytes(root, &format!("naitools://{value}"))
            .map_err(|error| match error.code {
                "asset_missing" => StatusCode::NOT_FOUND,
                "invalid_input" | "image_format" | "asset_too_large" => {
                    StatusCode::UNSUPPORTED_MEDIA_TYPE
                }
                "storage_access_denied" => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            });
    }
    owned_png(root, value).map(|bytes| (bytes, "image/png"))
}
fn owned_png(root: &Path, id: &str) -> Result<Vec<u8>, StatusCode> {
    if !valid_id(id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let root = root.canonicalize().map_err(io_status)?;
    let path = root
        .join("outputs")
        .join(format!("{id}.png"))
        .canonicalize()
        .map_err(io_status)?;
    if !path.starts_with(&root) {
        return Err(StatusCode::FORBIDDEN);
    }
    let file = std::fs::File::open(&path).map_err(io_status)?;
    if !file.metadata().map_err(io_status)?.is_file() {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut bytes = Vec::new();
    file.take(studio_nai::assets::MAX_IMAGE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(io_status)?;
    if bytes.len() > studio_nai::assets::MAX_IMAGE || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    // Stored generation outputs have already passed bounded image validation.
    // Never re-encode original metadata or decode every visible card in Rust.
    Ok(bytes)
}
fn io_status(error: std::io::Error) -> StatusCode {
    match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protocol_accepts_only_exact_local_image_ids() {
        for url in [
            "http://naitools-image.localhost/id-123",
            "naitools-image://localhost/id_123",
            "http://naitools-image.localhost/imports/id-123.png",
            "http://naitools-image.localhost/imports/id-123.jpg",
            "http://naitools-image.localhost/imports/id-123.webp",
        ] {
            let r = Request::builder().uri(url).body(Vec::new()).unwrap();
            assert!(request_id(&r).is_ok());
        }
        for url in [
            "http://evil.localhost/id",
            "http://naitools-image.localhost:80/id",
            "http://naitools-image.localhost/../private",
            "http://naitools-image.localhost/%2e%2e",
            "http://naitools-image.localhost/id?path=C:/secret",
            "http://naitools-image.localhost/id.png",
            "http://naitools-image.localhost/",
            "http://naitools-image.localhost/imports/id",
            "http://naitools-image.localhost/imports/id.svg",
            "http://naitools-image.localhost/imports/../id.png",
            "http://naitools-image.localhost/imports/id.png/secret",
            "http://naitools-image.localhost/outputs/id.png",
        ] {
            let r = Request::builder().uri(url).body(Vec::new()).unwrap();
            assert!(request_id(&r).is_err(), "{url}");
        }
        assert!(request_id(
            &Request::builder()
                .method("POST")
                .uri("http://naitools-image.localhost/id")
                .body(Vec::new())
                .unwrap()
        )
        .is_err());
    }
    #[test]
    fn image_reads_are_bounded_and_errors_never_expose_paths() {
        let root = std::env::temp_dir().join(format!("naitools-protocol-{}", std::process::id()));
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        let png = b"\x89PNG\r\n\x1a\noriginal-metadata";
        std::fs::write(root.join("outputs/fixture.png"), png).unwrap();
        assert_eq!(owned_png(&root, "fixture").unwrap(), png);
        assert_eq!(
            owned_png(&root, "../private").unwrap_err(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            owned_png(&root, "missing").unwrap_err(),
            StatusCode::NOT_FOUND
        );
        std::fs::write(root.join("outputs/not-png.png"), b"private").unwrap();
        assert_eq!(
            owned_png(&root, "not-png").unwrap_err(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        std::fs::File::create(root.join("outputs/large.png"))
            .unwrap()
            .set_len(studio_nai::assets::MAX_IMAGE as u64 + 1)
            .unwrap();
        assert_eq!(
            owned_png(&root, "large").unwrap_err(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        for name in ["fixture.png", "not-png.png", "large.png"] {
            std::fs::remove_file(root.join("outputs").join(name)).unwrap();
        }
        std::fs::remove_dir(root.join("outputs")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
