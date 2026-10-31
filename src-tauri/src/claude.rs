use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{
    ai_models::{config_for_task, ClaudeModelConfig, ClaudeModelSettingsState, ClaudeTask},
    api_key::{read_api_key, ApiKeyState},
    app_window::ensure_main_window,
};

const CLAUDE_REQUEST_TIMEOUT_SECS: u64 = 120;
#[cfg(any(debug_assertions, test))]
const CLAUDE_ERROR_BODY_PREVIEW_CHARS: usize = 500;

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
    system: String,
}

impl ClaudeRequest {
    fn with_config(config: ClaudeModelConfig, system: String, messages: Vec<Message>) -> Self {
        Self {
            model: config.model,
            max_tokens: config.max_tokens,
            messages,
            system,
        }
    }
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: Vec<Content>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Content {
    Text {
        #[serde(rename = "type")]
        type_: String,
        text: String,
    },
    Image {
        #[serde(rename = "type")]
        type_: String,
        source: ImageSource,
    },
}

#[derive(Serialize)]
struct ImageSource {
    #[serde(rename = "type")]
    type_: String,
    media_type: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeImageInput {
    base64: String,
    media_type: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ContentBlock>,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Serialize, Default)]
pub struct ClaudeUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
}

#[derive(Serialize)]
pub struct ClaudeTextResult {
    text: String,
    usage: ClaudeUsage,
}

fn claude_request_timeout() -> Duration {
    Duration::from_secs(CLAUDE_REQUEST_TIMEOUT_SECS)
}

#[cfg(any(debug_assertions, test))]
fn compact_error_body_preview(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = compact
        .chars()
        .take(CLAUDE_ERROR_BODY_PREVIEW_CHARS)
        .collect::<String>();
    if compact.chars().count() > CLAUDE_ERROR_BODY_PREVIEW_CHARS {
        preview.push_str("...");
    }
    preview
}

fn format_claude_api_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = format!("APIエラー {}: APIサーバーからエラーが返されました", status);

    #[cfg(debug_assertions)]
    {
        let preview = compact_error_body_preview(body);
        if preview.is_empty() {
            message
        } else {
            format!("{} (開発用詳細: {})", message, preview)
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = body;
        message
    }
}

async fn send_claude_request(
    api_key: &str,
    request: ClaudeRequest,
) -> Result<ClaudeTextResult, String> {
    let client = reqwest::Client::builder()
        .timeout(claude_request_timeout())
        .build()
        .map_err(|e| format!("HTTPクライアント初期化失敗: {}", e))?;

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!(
                    "リクエストが{}秒でタイムアウトしました",
                    CLAUDE_REQUEST_TIMEOUT_SECS
                )
            } else {
                format!("リクエスト失敗: {}", e)
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format_claude_api_error(status, &body));
    }

    let claude_response: ClaudeResponse = response.json().await.map_err(|e| {
        if e.is_timeout() {
            format!(
                "レスポンス受信が{}秒でタイムアウトしました",
                CLAUDE_REQUEST_TIMEOUT_SECS
            )
        } else {
            format!("レスポンス解析失敗: {}", e)
        }
    })?;

    let text = claude_response
        .content
        .into_iter()
        .filter_map(|c| c.text)
        .collect::<Vec<_>>()
        .join("\n");

    Ok(ClaudeTextResult {
        text,
        usage: claude_response.usage.unwrap_or_default(),
    })
}

fn image_content(data: String, media_type: String) -> Result<Content, String> {
    match media_type.as_str() {
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" => Ok(Content::Image {
            type_: "image".to_string(),
            source: ImageSource {
                type_: "base64".to_string(),
                media_type,
                data,
            },
        }),
        other => Err(format!("未対応の画像形式です: {}", other)),
    }
}

#[tauri::command]
pub async fn analyze_canvas_v2(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiKeyState>,
    model_state: tauri::State<'_, ClaudeModelSettingsState>,
    system_prompt: String,
    user_text: String,
    main_image_base64: String,
    reference_images: Vec<ClaudeImageInput>,
    auxiliary_images: Option<Vec<ClaudeImageInput>>,
    claude_task: Option<String>,
) -> Result<ClaudeTextResult, String> {
    ensure_main_window(&window)?;
    let api_key = read_api_key(&state)?;
    let mut content_blocks: Vec<Content> = Vec::new();

    // メイン画像
    content_blocks.push(Content::Image {
        type_: "image".to_string(),
        source: ImageSource {
            type_: "base64".to_string(),
            media_type: "image/png".to_string(),
            data: main_image_base64,
        },
    });

    // リファレンス画像（あれば）
    if !reference_images.is_empty() {
        content_blocks.push(Content::Text {
            type_: "text".to_string(),
            text: format!(
                "以下の {} 枚はユーザーが「こういう絵に近づけたい」と提示したリファレンスです。",
                reference_images.len()
            ),
        });
        for img in reference_images {
            content_blocks.push(image_content(img.base64, img.media_type)?);
        }
    }

    let auxiliary_images = auxiliary_images.unwrap_or_default();
    if !auxiliary_images.is_empty() {
        content_blocks.push(Content::Text {
            type_: "text".to_string(),
            text: format!(
                "以下の {} 枚は解析のための補助画像です。ユーザーが近づけたいリファレンス画像ではありません。",
                auxiliary_images.len()
            ),
        });
        for img in auxiliary_images {
            content_blocks.push(image_content(img.base64, img.media_type)?);
        }
    }

    content_blocks.push(Content::Text {
        type_: "text".to_string(),
        text: user_text,
    });

    let task = claude_task
        .as_deref()
        .and_then(ClaudeTask::from_wire_value)
        .unwrap_or(ClaudeTask::CanvasAnalysis);
    let request = ClaudeRequest::with_config(
        config_for_task(&app, &model_state, task)?,
        system_prompt,
        vec![Message {
            role: "user".to_string(),
            content: content_blocks,
        }],
    );

    send_claude_request(&api_key, request).await
}

// 旧コマンドも一応残しておく（破壊的変更を避けるため、内部は v2 に委譲）
#[tauri::command]
pub async fn analyze_canvas(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiKeyState>,
    model_state: tauri::State<'_, ClaudeModelSettingsState>,
    image_base64: String,
    user_prompt: String,
    canvas_width: u32,
    canvas_height: u32,
) -> Result<String, String> {
    ensure_main_window(&window)?;
    const DEFAULT_SYSTEM: &str = r##"あなたは絵描きアシスタントです。ユーザーが描いている途中の絵を見て、以下の形式の純粋なJSONのみで返答してください。前後に説明文や ```json などは絶対に含めないでください。

{
  "advice": "次にどこをどう描けばいいかの具体的なアドバイス（日本語、2〜4文）",
  "guides": [
    {"type": "line", "x1": 100, "y1": 100, "x2": 200, "y2": 200, "color": "#ff6b9d", "label": "頭部の中心線"}
  ]
}

座標はキャンバスのピクセル座標（左上が0,0）。guidesは0〜6個。色は明度高めの色。"##;

    let user_text = format!(
        "キャンバスサイズ: {}x{}ピクセル\n\nユーザーからの相談: {}",
        canvas_width, canvas_height, user_prompt
    );

    let api_key = read_api_key(&state)?;
    let request = ClaudeRequest::with_config(
        config_for_task(&app, &model_state, ClaudeTask::CanvasAnalysis)?,
        DEFAULT_SYSTEM.to_string(),
        vec![Message {
            role: "user".to_string(),
            content: vec![
                Content::Image {
                    type_: "image".to_string(),
                    source: ImageSource {
                        type_: "base64".to_string(),
                        media_type: "image/png".to_string(),
                        data: image_base64,
                    },
                },
                Content::Text {
                    type_: "text".to_string(),
                    text: user_text,
                },
            ],
        }],
    );
    send_claude_request(&api_key, request)
        .await
        .map(|result| result.text)
}

// ===== チャット =====
// フロントから送られてくるメッセージ表現。content_text と attached_image_base64
// （任意）を持つ。assistant メッセージは text のみ。

#[derive(Deserialize)]
pub struct ChatTurn {
    role: String,
    text: String,
    #[serde(default)]
    image_base64: Option<String>,
}

fn build_chat_messages(history: Vec<ChatTurn>) -> Result<Vec<Message>, String> {
    let mut messages: Vec<Message> = Vec::with_capacity(history.len());
    for turn in history {
        let role = match turn.role.as_str() {
            "user" | "assistant" => turn.role,
            other => return Err(format!("不正な role: {}", other)),
        };

        let mut content_blocks: Vec<Content> = Vec::new();
        let has_image = matches!(&turn.image_base64, Some(s) if !s.is_empty());
        if let Some(img) = turn.image_base64 {
            if !img.is_empty() {
                content_blocks.push(Content::Image {
                    type_: "image".to_string(),
                    source: ImageSource {
                        type_: "base64".to_string(),
                        media_type: "image/png".to_string(),
                        data: img,
                    },
                });
            }
        }

        let trimmed = turn.text.trim();
        let text = if trimmed.is_empty() {
            if has_image {
                "(キャンバスを添付しました)".to_string()
            } else {
                return Err("空のメッセージは送信できません".to_string());
            }
        } else {
            turn.text
        };
        content_blocks.push(Content::Text {
            type_: "text".to_string(),
            text,
        });
        messages.push(Message {
            role,
            content: content_blocks,
        });
    }

    if messages.is_empty() {
        return Err("メッセージが空です".to_string());
    }

    Ok(messages)
}

#[tauri::command]
pub async fn chat_with_claude(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiKeyState>,
    model_state: tauri::State<'_, ClaudeModelSettingsState>,
    system_prompt: String,
    history: Vec<ChatTurn>,
) -> Result<ClaudeTextResult, String> {
    ensure_main_window(&window)?;
    let api_key = read_api_key(&state)?;
    let messages = build_chat_messages(history)?;

    let request = ClaudeRequest::with_config(
        config_for_task(&app, &model_state, ClaudeTask::Chat)?,
        system_prompt,
        messages,
    );

    send_claude_request(&api_key, request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_blocks(message: &Message) -> Vec<&str> {
        message
            .content
            .iter()
            .filter_map(|content| match content {
                Content::Text { text, .. } => Some(text.as_str()),
                Content::Image { .. } => None,
            })
            .collect()
    }

    fn image_media_types(message: &Message) -> Vec<&str> {
        message
            .content
            .iter()
            .filter_map(|content| match content {
                Content::Text { .. } => None,
                Content::Image { source, .. } => Some(source.media_type.as_str()),
            })
            .collect()
    }

    fn expect_build_error(result: Result<Vec<Message>, String>) -> String {
        match result {
            Ok(_) => panic!("expected build_chat_messages to fail"),
            Err(err) => err,
        }
    }

    #[test]
    fn claude_request_uses_supplied_model_config() {
        let request = ClaudeRequest::with_config(
            ClaudeModelConfig {
                model: "test-model".to_string(),
                max_tokens: 1234,
            },
            "system".to_string(),
            vec![Message {
                role: "user".to_string(),
                content: vec![Content::Text {
                    type_: "text".to_string(),
                    text: "hello".to_string(),
                }],
            }],
        );

        assert_eq!(request.model, "test-model");
        assert_eq!(request.max_tokens, 1234);
    }

    #[test]
    fn claude_request_timeout_is_two_minutes() {
        assert_eq!(claude_request_timeout(), Duration::from_secs(120));
    }

    #[test]
    fn compact_error_body_preview_collapses_and_truncates_body() {
        let body = format!("line 1\n\t{}\nline 3", "x".repeat(600));
        let preview = compact_error_body_preview(&body);

        assert!(preview.starts_with("line 1 "));
        assert!(preview.ends_with("..."));
        assert!(!preview.contains('\n'));
        assert!(preview.chars().count() <= CLAUDE_ERROR_BODY_PREVIEW_CHARS + 3);
    }

    #[test]
    fn format_claude_api_error_uses_short_user_facing_message() {
        let err = format_claude_api_error(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"message":"too much detail"}}"#,
        );

        assert!(err.contains("APIエラー 400 Bad Request"));
        assert!(err.contains("APIサーバーからエラーが返されました"));

        #[cfg(debug_assertions)]
        assert!(err.contains("開発用詳細"));
    }

    #[test]
    fn build_chat_messages_accepts_user_and_assistant_roles() {
        let messages = build_chat_messages(vec![
            ChatTurn {
                role: "user".to_string(),
                text: "hello".to_string(),
                image_base64: None,
            },
            ChatTurn {
                role: "assistant".to_string(),
                text: "reply".to_string(),
                image_base64: None,
            },
        ])
        .expect("valid chat turns should build");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(text_blocks(&messages[0]), vec!["hello"]);
        assert_eq!(text_blocks(&messages[1]), vec!["reply"]);
    }

    #[test]
    fn build_chat_messages_rejects_invalid_role() {
        let err = expect_build_error(build_chat_messages(vec![ChatTurn {
            role: "system".to_string(),
            text: "hidden".to_string(),
            image_base64: None,
        }]));

        assert!(err.contains("system"));
    }

    #[test]
    fn build_chat_messages_rejects_empty_text_without_image() {
        let err = expect_build_error(build_chat_messages(vec![ChatTurn {
            role: "user".to_string(),
            text: "  ".to_string(),
            image_base64: None,
        }]));

        assert!(!err.is_empty());
    }

    #[test]
    fn build_chat_messages_keeps_image_only_turn_sendable() {
        let messages = build_chat_messages(vec![ChatTurn {
            role: "user".to_string(),
            text: "  ".to_string(),
            image_base64: Some("base64-image".to_string()),
        }])
        .expect("image-only turns should get placeholder text");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content.len(), 2);
        assert!(matches!(messages[0].content[0], Content::Image { .. }));
        assert_eq!(text_blocks(&messages[0]).len(), 1);
        assert!(!text_blocks(&messages[0])[0].trim().is_empty());
    }

    #[test]
    fn image_content_preserves_reference_media_type() {
        let message = Message {
            role: "user".to_string(),
            content: vec![
                image_content("jpeg-data".to_string(), "image/jpeg".to_string())
                    .expect("jpeg should be supported"),
                image_content("webp-data".to_string(), "image/webp".to_string())
                    .expect("webp should be supported"),
            ],
        };

        assert_eq!(
            image_media_types(&message),
            vec!["image/jpeg", "image/webp"]
        );
    }

    #[test]
    fn image_content_rejects_unsupported_media_type() {
        let err = match image_content("svg-data".to_string(), "image/svg+xml".to_string()) {
            Ok(_) => panic!("svg should not be sent as a Claude image payload"),
            Err(err) => err,
        };

        assert!(err.contains("image/svg+xml"));
    }
}
