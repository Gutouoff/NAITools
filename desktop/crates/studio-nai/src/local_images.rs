//! Local-only original-renderer image services. Renderer references never grant
//! access to arbitrary paths. Original bytes (including metadata) are retained.
use crate::assets::{self, MAX_IMAGE};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use studio_core::{dto::valid_id, error::AppError};

const PREFIX: &str = "naitools://";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImage {
    pub file_path: String,
    pub file_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataSnapshot {
    pub name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub last_modified: u64,
    pub base64: String,
}

fn format(bytes: &[u8]) -> Result<(&'static str, &'static str), AppError> {
    match image::guess_format(bytes).map_err(|_| AppError::invalid())? {
        ImageFormat::Png => Ok(("png", "image/png")),
        ImageFormat::Jpeg => Ok(("jpg", "image/jpeg")),
        ImageFormat::WebP => Ok(("webp", "image/webp")),
        _ => Err(AppError::new("image_format", "仅支持 PNG、JPEG、WebP。")),
    }
}

pub fn reference_path(root: &Path, reference: &str) -> Result<PathBuf, AppError> {
    let value = reference.strip_prefix(PREFIX).ok_or_else(AppError::invalid)?;
    let (folder, file) = value.split_once('/').ok_or_else(AppError::invalid)?;
    let (id, extension) = file.rsplit_once('.').ok_or_else(AppError::invalid)?;
    if !valid_id(id) || !matches!(folder, "imports" | "outputs")
        || !matches!(extension, "png" | "jpg" | "webp")
        || (folder == "outputs" && extension != "png")
    {
        return Err(AppError::invalid());
    }
    let path = assets::path(root, folder, id, extension)?;
    // Reject symlinks/junction escapes too, not only textual traversal.
    let canonical_root = root.canonicalize().map_err(|error| AppError::storage_io(&error))?;
    let canonical_path = path.canonicalize().map_err(|error| AppError::storage_io(&error))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::invalid());
    }
    Ok(canonical_path)
}

fn image(reference: String, bytes: &[u8]) -> Result<LocalImage, AppError> {
    let decoded = assets::decode(bytes)?;
    let (_, mime) = format(bytes)?;
    Ok(LocalImage {
        file_path: reference,
        file_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        width: decoded.width(),
        height: decoded.height(),
    })
}

pub fn import_bytes(root: &Path, bytes: &[u8]) -> Result<LocalImage, AppError> {
    let (extension, _) = format(bytes)?;
    let id = uuid::Uuid::new_v4().to_string();
    let reference = format!("{PREFIX}imports/{id}.{extension}");
    let image = image(reference, bytes)?;
    // Validate before writing; do not re-encode and discard embedded metadata.
    assets::atomic_write(&assets::path(root, "imports", &id, extension)?, bytes)?;
    Ok(image)
}

pub fn read_image(root: &Path, reference: &str) -> Result<LocalImage, AppError> {
    let bytes = assets::read_bounded(&reference_path(root, reference)?, MAX_IMAGE)?;
    image(reference.to_owned(), &bytes)
}

impl MetadataSnapshot {
    fn validate(&self) -> Result<(), AppError> {
        if self.name.is_empty() || self.name.len() > 1024
            || self.last_modified > 9_007_199_254_740_991
            || self.base64.len() > MAX_IMAGE * 4 / 3 + 8
        {
            return Err(AppError::invalid());
        }
        let bytes = STANDARD.decode(&self.base64).map_err(|_| AppError::invalid())?;
        let (_, mime) = format(&bytes)?;
        if !self.media_type.is_empty() && self.media_type != mime { return Err(AppError::invalid()); }
        assets::decode(&bytes)?;
        Ok(())
    }
}

pub fn snapshot_from_reference(root: &Path, reference: &str) -> Result<MetadataSnapshot, AppError> {
    let path = reference_path(root, reference)?;
    let bytes = assets::read_bounded(&path, MAX_IMAGE)?;
    assets::decode(&bytes)?;
    let (_, mime) = format(&bytes)?;
    let last_modified = std::fs::metadata(&path).map_err(|error| AppError::storage_io(&error))?
        .modified().map_err(|error| AppError::storage_io(&error))?
        .duration_since(std::time::UNIX_EPOCH).map_err(|_| AppError::invalid())?
        .as_millis().try_into().map_err(|_| AppError::invalid())?;
    Ok(MetadataSnapshot {
        name: path.file_name().and_then(|name| name.to_str()).ok_or_else(AppError::invalid)?.into(),
        media_type: mime.into(), last_modified, base64: STANDARD.encode(bytes),
    })
}

fn snapshot_path(root: &Path) -> PathBuf { root.join("langbai").join("metadata-snapshot.json") }

pub fn save_snapshot(root: &Path, snapshot: &MetadataSnapshot) -> Result<(), AppError> {
    snapshot.validate()?;
    let mut normalized = snapshot.clone();
    if normalized.media_type.is_empty() {
        let original = STANDARD.decode(&normalized.base64).map_err(|_| AppError::invalid())?;
        normalized.media_type = format(&original)?.1.into();
    }
    let bytes = serde_json::to_vec(&normalized).map_err(|_| AppError::invalid())?;
    assets::atomic_write(&snapshot_path(root), &bytes)
}

pub fn load_snapshot(root: &Path) -> Result<Option<MetadataSnapshot>, AppError> {
    let path = snapshot_path(root);
    match std::fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::storage_io(&error)),
        Ok(_) => {},
    }
    let bytes = assets::read_bounded(&path, MAX_IMAGE * 4 / 3 + 2048)?;
    let snapshot: MetadataSnapshot = serde_json::from_slice(&bytes).map_err(|_| AppError::storage())?;
    snapshot.validate().map_err(|_| AppError::storage())?;
    Ok(Some(snapshot))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Vec<u8> { assets::png(&image::DynamicImage::new_rgb8(64, 48)).unwrap() }

    #[test]
    fn imports_preserve_original_bytes_and_full_dimensions() {
        let root = tempfile::tempdir().unwrap();
        let bytes = fixture();
        let result = import_bytes(root.path(), &bytes).unwrap();
        assert_eq!((result.width, result.height), (64, 48));
        assert_eq!(std::fs::read(reference_path(root.path(), &result.file_path).unwrap()).unwrap(), bytes);
        assert_eq!(read_image(root.path(), &result.file_path).unwrap().file_url, result.file_url);
        assert_eq!(snapshot_from_reference(root.path(), &result.file_path).unwrap().base64, STANDARD.encode(bytes));
    }

    #[test]
    fn only_owned_references_are_readable() {
        let root = tempfile::tempdir().unwrap();
        for reference in ["C:\\Users\\private.png", "file:///private.png", "naitools://imports/../private.png", "naitools://imports/id.png?x=1", "naitools://outputs/id.jpg", "naitools://assets/id.png", "naitools://imports/id.png/other"] {
            assert!(read_image(root.path(), reference).is_err(), "{reference}");
        }
    }

    #[test]
    fn snapshots_round_trip_without_touching_workbench_or_database() {
        let root = tempfile::tempdir().unwrap();
        assert!(load_snapshot(root.path()).unwrap().is_none());
        let snapshot = MetadataSnapshot { name: "source.png".into(), media_type: "image/png".into(), last_modified: 123, base64: STANDARD.encode(fixture()) };
        save_snapshot(root.path(), &snapshot).unwrap();
        let loaded = load_snapshot(root.path()).unwrap().unwrap();
        assert_eq!(loaded.base64, snapshot.base64);
        assert_eq!(loaded.name, snapshot.name);
        assert!(!root.path().join("studio.sqlite3").exists());
    }

    #[test]
    fn invalid_imports_and_snapshots_never_overwrite_existing_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let mut snapshot = MetadataSnapshot { name: "source.png".into(), media_type: "image/png".into(), last_modified: 0, base64: STANDARD.encode(fixture()) };
        save_snapshot(root.path(), &snapshot).unwrap();
        snapshot.media_type = "image/jpeg".into();
        assert!(save_snapshot(root.path(), &snapshot).is_err());
        assert_eq!(load_snapshot(root.path()).unwrap().unwrap().media_type, "image/png");
        assert!(import_bytes(root.path(), b"not an image").is_err());
        std::fs::write(snapshot_path(root.path()), b"corrupt").unwrap();
        assert!(load_snapshot(root.path()).is_err());
        assert_eq!(std::fs::read(snapshot_path(root.path())).unwrap(), b"corrupt");
    }

    #[test]
    fn original_png_text_metadata_survives_import_and_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let mut bytes = fixture();
        let text = b"Comment\0{\"prompt\":\"artist:example, 1girl\",\"seed\":42}";
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&(text.len() as u32).to_be_bytes());
        chunk.extend_from_slice(b"tEXt");
        chunk.extend_from_slice(text);
        let mut crc = u32::MAX;
        for byte in &chunk[4..] {
            crc ^= *byte as u32;
            for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1)); }
        }
        chunk.extend_from_slice(&(!crc).to_be_bytes());
        bytes.splice(bytes.len() - 12..bytes.len() - 12, chunk);
        let image = import_bytes(root.path(), &bytes).unwrap();
        let snapshot = snapshot_from_reference(root.path(), &image.file_path).unwrap();
        assert_eq!(STANDARD.decode(snapshot.base64).unwrap(), bytes);
        assert!(assets::metadata(&bytes).unwrap().entries.iter().any(|entry| entry.key == "Comment" && entry.value.contains("artist:example")));
    }

    #[test]
    fn jpeg_and_webp_keep_their_original_mime_and_bytes() {
        let root = tempfile::tempdir().unwrap();
        for (format, mime) in [(ImageFormat::Jpeg, "image/jpeg"), (ImageFormat::WebP, "image/webp")] {
            let mut buffer = std::io::Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(16, 24).write_to(&mut buffer, format).unwrap();
            let original = buffer.into_inner();
            let imported = import_bytes(root.path(), &original).unwrap();
            assert!(imported.file_url.starts_with(&format!("data:{mime};base64,")));
            let snapshot = snapshot_from_reference(root.path(), &imported.file_path).unwrap();
            assert_eq!(snapshot.media_type, mime);
            assert_eq!(STANDARD.decode(snapshot.base64).unwrap(), original);
        }
    }

    #[test]
    fn absent_browser_mime_is_derived_from_validated_bytes() {
        let root = tempfile::tempdir().unwrap();
        let snapshot = MetadataSnapshot { name: "image.png".into(), media_type: "".into(), last_modified: 0, base64: STANDARD.encode(fixture()) };
        save_snapshot(root.path(), &snapshot).unwrap();
        assert_eq!(load_snapshot(root.path()).unwrap().unwrap().media_type, "image/png");
    }
}
