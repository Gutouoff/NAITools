//! Local reference preset services; no HTTP, credentials or paid task submission.
use crate::{assets, local_images};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;
use studio_core::{
    error::AppError,
    reference_presets::{ReferenceLibrary, ReferenceParameters, ReferenceRecord, ReferenceStore},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    #[serde(flatten)]
    pub parameters: ReferenceParameters,
    pub base64: String,
    // Renderer dimensions/extensions are descriptive only. Actual bytes decide.
    pub extension: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub preset: ReferenceRecord,
    pub base64: String,
}
pub fn open(root: &Path) -> Result<ReferenceStore, AppError> {
    ReferenceStore::open(&root.join("langbai/reference-presets.sqlite3"))
}
pub fn list(root: &Path) -> Result<ReferenceLibrary, AppError> {
    open(root)?.list()
}
pub fn save(root: &Path, mut request: SaveRequest) -> Result<ReferenceLibrary, AppError> {
    request.parameters.name = request.parameters.name.trim().into();
    request.parameters.group = request.parameters.group.trim().into();
    request.parameters.validate()?;
    if request.base64.len() > assets::MAX_IMAGE.div_ceil(3) * 4 + 128 {
        return Err(AppError::new("asset_too_large", "参考图像不得超过 16 MB。"));
    }
    let raw = if request.base64.starts_with("data:") {
        let (header, content) = request
            .base64
            .split_once(',')
            .ok_or_else(AppError::invalid)?;
        if !matches!(
            header,
            "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
        ) {
            return Err(AppError::invalid());
        }
        content
    } else {
        &request.base64
    };
    let bytes = STANDARD.decode(raw).map_err(|_| AppError::invalid())?;
    let decoded = assets::decode(&bytes)?;
    let extension = match image::guess_format(&bytes).map_err(|_| AppError::invalid())? {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        _ => return Err(AppError::invalid()),
    };
    if request.width.is_some_and(|w| w != decoded.width())
        || request.height.is_some_and(|h| h != decoded.height())
    {
        return Err(AppError::new(
            "reference_dimensions",
            "参考图像尺寸与文件内容不一致；未保存预设。",
        ));
    }
    if request.extension.as_ref().is_some_and(|e| {
        let e = e.trim_start_matches('.').to_ascii_lowercase();
        e != extension && !(extension == "jpg" && e == "jpeg")
    }) {
        return Err(AppError::new(
            "image_format",
            "参考文件扩展名与图像内容不一致；未保存预设。",
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let row = ReferenceRecord {
        id: id.clone(),
        parameters: request.parameters,
        extension: extension.into(),
        created_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| AppError::storage())?
            .as_millis()
            .try_into()
            .map_err(|_| AppError::storage())?,
        width: decoded.width(),
        height: decoded.height(),
    };
    let mut db = open(root)?;
    let path = assets::path(root, "imports", &id, extension)?;
    assets::atomic_write(&path, &bytes)?;
    if let Err(error) = db.save(&row) {
        // Only this freshly generated, validated asset may be removed on failure.
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    db.list()
}
pub fn read(root: &Path, id: &str) -> Result<ReadResult, AppError> {
    let preset = open(root)?.read(id)?;
    let reference = format!("naitools://imports/{}.{}", preset.id, preset.extension);
    let path = local_images::reference_path(root, &reference)?;
    let bytes = assets::read_bounded(&path, assets::MAX_IMAGE)?;
    let decoded = assets::decode(&bytes)?;
    if decoded.width() != preset.width || decoded.height() != preset.height {
        return Err(AppError::new(
            "reference_dimensions",
            "参考预设图像与已保存尺寸不一致；未应用预设。",
        ));
    }
    Ok(ReadResult {
        preset,
        base64: STANDARD.encode(bytes),
    })
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditAction {
    Delete,
    CreateGroup,
    DeleteGroup,
    Move,
}
pub fn edit(
    root: &Path,
    action: EditAction,
    id: Option<&str>,
    group: Option<&str>,
) -> Result<ReferenceLibrary, AppError> {
    let mut db = open(root)?;
    match action {
        EditAction::Delete => db.delete(id.ok_or_else(AppError::invalid)?)?,
        EditAction::CreateGroup => db.edit_group(group.ok_or_else(AppError::invalid)?, false)?,
        EditAction::DeleteGroup => db.edit_group(group.ok_or_else(AppError::invalid)?, true)?,
        EditAction::Move => db.move_to_group(
            id.ok_or_else(AppError::invalid)?,
            group.ok_or_else(AppError::invalid)?,
        )?,
    }
    db.list()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png() -> Vec<u8> {
        let image = image::DynamicImage::new_rgb8(2, 3);
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }
    fn request(bytes: &[u8]) -> SaveRequest {
        serde_json::from_value(serde_json::json!({"name":"参考预设","group":"组一","kind":"precise","base64":STANDARD.encode(bytes),"extension":"png","width":2,"height":3,"preciseType":"character&style","infoExtracted":0.65,"strength":0.45,"fidelity":0.8})).unwrap()
    }
    #[test]
    fn presets_preserve_original_bytes_parameters_and_do_not_touch_main_database() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("studio.sqlite3"), b"do not open or migrate").unwrap();
        let bytes = png();
        let library = save(root, request(&bytes)).unwrap();
        let id = &library.presets[0].id;
        let result = read(root, id).unwrap();
        assert_eq!(STANDARD.decode(result.base64).unwrap(), bytes);
        assert_eq!(result.preset.parameters.strength, 0.45);
        assert_eq!(result.preset.parameters.fidelity, 0.8);
        edit(root, EditAction::DeleteGroup, None, Some("组一")).unwrap();
        assert_eq!(read(root, id).unwrap().preset.parameters.group, "");
        edit(root, EditAction::Delete, Some(id), None).unwrap();
        assert!(list(root).unwrap().presets.is_empty());
        assert_eq!(
            std::fs::read(root.join("studio.sqlite3")).unwrap(),
            b"do not open or migrate"
        );
        assert!(
            assets::path(root, "imports", id, "png").unwrap().is_file(),
            "Deleting the library entry must not break applied workbench references"
        );
    }
    #[test]
    fn invalid_images_and_mismatched_dimensions_never_create_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(save(root, request(b"not an image")).is_err());
        let mut r = request(&png());
        r.width = Some(99);
        assert!(save(root, r).is_err());
        let mut r = request(&png());
        r.extension = Some("webp".into());
        assert!(save(root, r).is_err());
        let mut r = request(&png());
        r.parameters.strength = -0.1;
        assert!(save(root, r).is_err());
        assert!(list(root).unwrap().presets.is_empty());
        assert!(!root.join("imports").exists());
        assert!(read(root, "../../private").is_err());
    }
    #[test]
    fn missing_assets_and_corrupt_library_are_explicit_errors() {
        let dir = tempfile::tempdir().unwrap();
        let library = save(dir.path(), request(&png())).unwrap();
        let row = &library.presets[0];
        std::fs::remove_file(assets::path(dir.path(), "imports", &row.id, "png").unwrap()).unwrap();
        assert!(read(dir.path(), &row.id).is_err());
        assert_eq!(
            list(dir.path()).unwrap().presets.len(),
            1,
            "Do not silently drop missing assets"
        );
        drop(open(dir.path()).unwrap());
        let db = dir.path().join("langbai/reference-presets.sqlite3");
        std::fs::write(&db, b"broken database").unwrap();
        assert_eq!(list(dir.path()).unwrap_err().code, "storage_corrupt");
        assert_eq!(std::fs::read(&db).unwrap(), b"broken database");
    }
}
