//! Compatibility preferences for the frozen Langbai renderer. No credentials,
//! provider configuration or filesystem authority is stored by this contract.
use crate::error::AppError;
use serde_json::Value;

pub const DEFAULTS: &str = include_str!("langbai-defaults.json");
const MAX_VALUE_BYTES: usize = 1_500_000;
const WRITABLE: &[&str] = &[
    "hasOnboarded", "language", "theme", "reduceMotion", "completionSound",
    "autoComplete", "weightHighlight", "promptRandomizer", "superDrop",
    "showFloatingToolbar", "historyJumpAfterGenerate", "modelMode",
    "lockStylePrompt", "lockNegativePrompt", "savedStylePrompt", "savedNegativePrompt",
    "promptTemplates", "stylePromptPresets", "stylePromptPresetGroups", "positivePromptPresets",
    "promptChunks", "characterPromptPresets", "stylePromptPresetSort", "lastGenerationState",
    "persistGenerateParams", "persistI2IParams", "persistInpaintParams", "persistUpscaleParams",
    "persistDirectorParams",
];

pub fn defaults() -> Result<Value, AppError> {
    serde_json::from_str(DEFAULTS).map_err(|_| AppError::storage())
}

fn contains_secret_key(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let lower = key.to_ascii_lowercase();
            lower.contains("apikey")
                || lower.contains("api_key")
                || lower.contains("secret")
                || matches!(lower.as_str(), "token" | "password" | "authorization")
                || contains_secret_key(value)
        }),
        Value::Array(array) => array.iter().any(contains_secret_key),
        _ => false,
    }
}

pub fn validate(key: &str, value: &Value) -> Result<(), AppError> {
    if !WRITABLE.contains(&key) {
        return Err(AppError::new(
            "langbai_setting_unsupported",
            "该设置尚未接入 Rust 服务；未保存。凭据及服务端点请使用连接配置。",
        ));
    }
    let size = serde_json::to_vec(value).map_err(|_| AppError::invalid())?.len();
    if size > MAX_VALUE_BYTES || contains_secret_key(value) {
        return Err(AppError::invalid());
    }
    let baseline = defaults()?;
    let same_type = match key {
        "characterPromptPresets" => value.is_array(),
        "stylePromptPresetSort" => value.is_string(),
        "lastGenerationState" => value.is_null() || value.is_object(),
        _ => match &baseline[key] {
            Value::Bool(_) => value.is_boolean(),
            Value::String(_) => value.is_string(),
            Value::Array(_) => value.is_array(),
            Value::Object(_) => value.is_object(),
            _ => false,
        },
    };
    if !same_type {
        return Err(AppError::invalid());
    }
    let allowed = match key {
        "language" => matches!(value.as_str(), Some("zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR")),
        "theme" => matches!(value.as_str(), Some("light" | "dark" | "system")),
        "modelMode" => matches!(value.as_str(), Some("anime" | "furry")),
        "stylePromptPresetGroups" => value.as_array().is_some_and(|array| {
            array.len() <= 1024
                && array.iter().all(|item| item.as_str().is_some_and(|text| text.len() <= 1024))
        }),
        "completionSound" => valid_completion_sound(value),
        _ => true,
    };
    if allowed { Ok(()) } else { Err(AppError::invalid()) }
}

fn valid_completion_sound(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 4
            && object.get("enabled").is_some_and(Value::is_boolean)
            && object.get("volume").and_then(Value::as_f64).is_some_and(|volume| (0.0..=1.0).contains(&volume))
            && object.get("name").and_then(Value::as_str).is_some_and(|name| name.chars().count() <= 160)
            && object.get("dataUrl").and_then(Value::as_str).is_some_and(|url| url.is_empty() || valid_audio_url(url))
    })
}

fn valid_audio_url(url: &str) -> bool {
    let Some((header, body)) = url.split_once(',') else { return false; };
    matches!(header,
        "data:audio/mpeg;base64" | "data:audio/mp3;base64" | "data:audio/wav;base64"
        | "data:audio/x-wav;base64" | "data:audio/wave;base64" | "data:audio/ogg;base64"
    ) && !body.is_empty()
        && body.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_match_original_and_have_no_live_credentials() {
        let settings = defaults().unwrap();
        assert_eq!(settings.as_object().unwrap().len(), 109);
        assert_eq!(settings["hasOnboarded"], false);
        assert_eq!(settings["savedStylePrompt"], "");
        for key in ["imageApiKey", "visionApiKey", "convertApiKey", "agentApiKey", "tagServerApiKey", "baiduSecret", "translateAiApiKey"] {
            assert_eq!(settings[key], "");
        }
    }

    #[test]
    fn reject_credentials_endpoints_and_nonfunctional_settings() {
        for key in ["imageApiKey", "visionApiKey", "outputDir", "apiBaseUrl", "imageBaseUrl", "allowCustomEndpointFallback", "autoBackupEnabled", "streamPreviewEnabled", "unknown"] {
            assert_eq!(validate(key, &json!("x")).unwrap_err().code, "langbai_setting_unsupported");
        }
        assert!(validate("promptTemplates", &json!([{"apiKey": "private"}])).is_err());
        assert!(validate("lastGenerationState", &json!({"nested": {"authorization": "private"}})).is_err());
    }

    #[test]
    fn types_enums_and_audio_are_bounded() {
        assert!(validate("theme", &json!("dark")).is_ok());
        assert!(validate("theme", &json!("invalid")).is_err());
        assert!(validate("theme", &json!(true)).is_err());
        assert!(validate("reduceMotion", &json!(true)).is_ok());
        assert!(validate("stylePromptPresets", &json!({})).is_err());
        assert!(validate("savedStylePrompt", &json!("x".repeat(MAX_VALUE_BYTES))).is_err());
        assert!(validate("completionSound", &json!({"enabled": false, "volume": 0.5, "name": "", "dataUrl": ""})).is_ok());
        assert!(validate("completionSound", &json!({"enabled": true, "volume": 2, "name": "", "dataUrl": "https://invalid/"})).is_err());
    }
}
