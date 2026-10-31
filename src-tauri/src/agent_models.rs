use std::{collections::HashMap, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{
    api_key::{read_api_key, read_gpt_api_key, ApiKeyState, GptApiKeyState},
    app_window::ensure_main_window,
};

const MODEL_REQUEST_TIMEOUT_SECS: u64 = 120;
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ModelProvider {
    Openai,
    Anthropic,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTool {
    name: String,
    description: String,
    parameters: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelToolResult {
    call_id: String,
    output: Value,
    #[serde(default)]
    is_error: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReferenceImage {
    name: String,
    data_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    provider: ModelProvider,
    model: String,
    instructions: String,
    text: String,
    image_data_url: Option<String>,
    #[serde(default)]
    reference_images: Vec<ModelReferenceImage>,
    reasoning_effort: Option<ReasoningEffort>,
    #[serde(default)]
    tools: Vec<ModelTool>,
    max_output_tokens: u32,
    continuation: Option<String>,
    #[serde(default)]
    tool_results: Vec<ModelToolResult>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelToolCall {
    id: String,
    name: String,
    arguments: Map<String, Value>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelResponse {
    text: String,
    calls: Vec<ModelToolCall>,
    input_tokens: u64,
    output_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    continuation: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "provider", rename_all = "lowercase")]
enum ModelContinuation {
    Openai {
        #[serde(rename = "previousResponseId")]
        previous_response_id: String,
    },
    Anthropic {
        messages: Vec<Value>,
    },
}

fn request_timeout() -> Duration {
    Duration::from_secs(MODEL_REQUEST_TIMEOUT_SECS)
}

fn parse_continuation(raw: Option<&str>) -> Result<Option<ModelContinuation>, String> {
    raw.map(|value| {
        serde_json::from_str(value)
            .map_err(|_| "モデル継続情報が不正です。新しい作業として再実行してください".to_string())
    })
    .transpose()
}

fn serialize_continuation(value: &ModelContinuation) -> Result<String, String> {
    serde_json::to_string(value).map_err(|_| "モデル継続情報を保存できません".to_string())
}

fn validate_request(request: &ModelRequest) -> Result<(), String> {
    if request.reference_images.len() > 3 {
        return Err("お手本は3枚まで指定できます".to_string());
    }
    for image in &request.reference_images {
        if image.name.trim().is_empty()
            || image.name.chars().count() > 300
            || image.data_url.len() > 2_810_300
        {
            return Err("お手本の名前または画像サイズが不正です".to_string());
        }
        parse_image_data_url(&image.data_url)?;
    }
    if request.model.trim().is_empty() {
        return Err("モデル名を指定してください".to_string());
    }
    if request.max_output_tokens == 0 {
        return Err("最大出力トークン数は1以上にしてください".to_string());
    }
    if request.continuation.is_none()
        && request.text.trim().is_empty()
        && request.image_data_url.is_none()
    {
        return Err("モデルに送るテキストまたは画像が必要です".to_string());
    }
    if request.continuation.is_none() && !request.tool_results.is_empty() {
        return Err("ツール実行結果にはモデル継続情報が必要です".to_string());
    }
    for tool in &request.tools {
        if tool.name.trim().is_empty() {
            return Err("ツール名を空にできません".to_string());
        }
    }
    for result in &request.tool_results {
        if result.call_id.trim().is_empty() {
            return Err("ツール呼び出し ID を空にできません".to_string());
        }
    }
    Ok(())
}

fn encode_provider_tool_name(name: &str) -> String {
    let mut encoded = String::new();
    for byte in name.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' => encoded.push(char::from(byte)),
            b'.' => encoded.push_str("__"),
            other => encoded.push_str(&format!("_x{other:02X}_")),
        }
    }
    encoded
}

fn tool_name_map(tools: &[ModelTool]) -> Result<HashMap<String, String>, String> {
    let mut names = HashMap::new();
    for tool in tools {
        let encoded = encode_provider_tool_name(&tool.name);
        if encoded.len() > 64 {
            return Err(format!("ツール名が長すぎます: {}", tool.name));
        }
        if names.insert(encoded, tool.name.clone()).is_some() {
            return Err("ツール名が重複しています".to_string());
        }
    }
    Ok(names)
}

fn canonical_tool_name<'a>(
    safe_name: &str,
    names: &'a HashMap<String, String>,
) -> Result<&'a str, String> {
    names
        .get(safe_name)
        .map(String::as_str)
        .ok_or_else(|| format!("モデルが未登録のツールを要求しました: {safe_name}"))
}

fn parse_image_data_url(data_url: &str) -> Result<(&str, &str), String> {
    let (header, data) = data_url
        .split_once(',')
        .ok_or_else(|| "画像 data URL が不正です".to_string())?;
    let media_type = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "画像は base64 data URL で指定してください".to_string())?;
    match media_type {
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" => {}
        _ => return Err(format!("未対応の画像形式です: {media_type}")),
    }
    if data.is_empty() {
        return Err("画像 data URL のデータが空です".to_string());
    }
    Ok((media_type, data))
}

fn output_string(output: &Value) -> Result<String, String> {
    match output {
        Value::String(value) => Ok(value.clone()),
        value => {
            serde_json::to_string(value).map_err(|_| "ツール実行結果を変換できません".to_string())
        }
    }
}

fn tool_image(output: &Value) -> Option<&str> {
    output
        .get("dataUrl")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("data:image/"))
}

fn tool_output_text(output: &Value) -> Result<String, String> {
    if tool_image(output).is_some() {
        let mut metadata = output.clone();
        if let Some(object) = metadata.as_object_mut() {
            object.remove("dataUrl");
            object.insert("imageAttached".into(), Value::Bool(true));
        }
        return output_string(&metadata);
    }
    output_string(output)
}

fn provider_tools(tools: &[ModelTool], anthropic: bool) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            let name = encode_provider_tool_name(&tool.name);
            if anthropic {
                json!({
                    "name": name,
                    "description": tool.description,
                    "input_schema": tool.parameters,
                })
            } else {
                json!({
                    "type": "function",
                    "name": name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                })
            }
        })
        .collect()
}

fn openai_input(request: &ModelRequest) -> Result<Vec<Value>, String> {
    let mut input = Vec::new();
    for result in &request.tool_results {
        input.push(json!({
            "type": "function_call_output",
            "call_id": result.call_id,
            "output": tool_output_text(&result.output)?,
        }));
    }

    let mut content = Vec::new();
    // 部分画像の取得結果も画像として渡す。base64の文字列だけでは視覚確認できない。
    for result in &request.tool_results {
        if let Some(data_url) = tool_image(&result.output) {
            parse_image_data_url(data_url)?;
            content.push(json!({"type": "input_text", "text": format!("ツール結果の画像 ({})", result.call_id)}));
            content.push(json!({"type": "input_image", "image_url": data_url}));
        }
    }
    if !request.text.trim().is_empty() {
        content.push(json!({"type": "input_text", "text": request.text}));
    }
    if let Some(data_url) = request.image_data_url.as_deref() {
        parse_image_data_url(data_url)?;
        content.push(json!({"type": "input_image", "image_url": data_url}));
    }
    for reference in &request.reference_images {
        parse_image_data_url(&reference.data_url)?;
        content.push(json!({"type":"input_text", "text":format!("お手本（目標の完成像）: {}。作業中のキャンバスとは別の比較用画像です。", reference.name)}));
        content
            .push(json!({"type":"input_image", "image_url":reference.data_url, "detail":"high"}));
    }
    if !content.is_empty() {
        input.push(json!({"role": "user", "content": content}));
    }
    Ok(input)
}

fn openai_request_body(
    request: &ModelRequest,
    previous_response_id: Option<&str>,
) -> Result<Value, String> {
    let mut body = json!({
        "model": request.model,
        "instructions": request.instructions,
        "input": openai_input(request)?,
        "tools": provider_tools(&request.tools, false),
        "max_output_tokens": request.max_output_tokens,
    });
    if let Some(id) = previous_response_id {
        body["previous_response_id"] = Value::String(id.to_string());
    }
    if let Some(effort) = &request.reasoning_effort {
        let effort = match effort {
            ReasoningEffort::Low => "low",
            ReasoningEffort::Medium => "medium",
            ReasoningEffort::High => "high",
            ReasoningEffort::Xhigh => "xhigh",
            ReasoningEffort::Max => "max",
        };
        body["reasoning"] = json!({"effort":effort});
    }
    Ok(body)
}

fn parse_openai_response(
    value: Value,
    names: &HashMap<String, String>,
) -> Result<ModelResponse, String> {
    match value.get("status").and_then(Value::as_str) {
        Some("failed") | Some("cancelled") => {
            return Err("GPT がレスポンスを生成できませんでした".to_string())
        }
        Some("incomplete") => {
            return Err("GPT のレスポンスが最大出力などの理由で完了しませんでした".to_string())
        }
        _ => {}
    }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "GPT のレスポンスに ID がありません".to_string())?;
    let output = value
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| "GPT のレスポンス形式が不正です".to_string())?;

    let mut texts = Vec::new();
    let mut calls = Vec::new();
    for item in output {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("output_text") {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                texts.push(text.to_string());
                            }
                        }
                    }
                }
            }
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| "GPT のツール呼び出し ID が不正です".to_string())?;
                let safe_name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "GPT のツール名が不正です".to_string())?;
                let raw_arguments = item
                    .get("arguments")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "GPT のツール引数が不正です".to_string())?;
                let arguments = serde_json::from_str::<Value>(raw_arguments)
                    .ok()
                    .and_then(|value| value.as_object().cloned())
                    .ok_or_else(|| "GPT のツール引数を解析できません".to_string())?;
                calls.push(ModelToolCall {
                    id: call_id.to_string(),
                    name: canonical_tool_name(safe_name, names)?.to_string(),
                    arguments,
                });
            }
            _ => {}
        }
    }

    let usage = value.get("usage").and_then(Value::as_object);
    let input_tokens = usage
        .and_then(|item| item.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|item| item.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let continuation = if calls.is_empty() {
        None
    } else {
        Some(serialize_continuation(&ModelContinuation::Openai {
            previous_response_id: id.to_string(),
        })?)
    };

    Ok(ModelResponse {
        text: texts.join("\n"),
        calls,
        input_tokens,
        output_tokens,
        continuation,
    })
}

fn anthropic_user_content(request: &ModelRequest) -> Result<Vec<Value>, String> {
    let mut content = Vec::new();
    for result in &request.tool_results {
        content.push(json!({
            "type": "tool_result",
            "tool_use_id": result.call_id,
            "content": tool_output_text(&result.output)?,
            "is_error": result.is_error,
        }));
    }
    for result in &request.tool_results {
        if let Some(data_url) = tool_image(&result.output) {
            let (media_type, data) = parse_image_data_url(data_url)?;
            content.push(
                json!({"type":"text", "text": format!("ツール結果の画像 ({})", result.call_id)}),
            );
            content.push(json!({"type":"image", "source":{"type":"base64", "media_type":media_type, "data":data}}));
        }
    }
    if let Some(data_url) = request.image_data_url.as_deref() {
        let (media_type, data) = parse_image_data_url(data_url)?;
        content.push(json!({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        }));
    }
    for reference in &request.reference_images {
        let (media_type, data) = parse_image_data_url(&reference.data_url)?;
        content.push(json!({"type":"text", "text":format!("お手本（目標の完成像）: {}。作業中のキャンバスと比較してください。", reference.name)}));
        content.push(
            json!({"type":"image", "source":{"type":"base64","media_type":media_type,"data":data}}),
        );
    }
    if !request.text.trim().is_empty() {
        content.push(json!({"type": "text", "text": request.text}));
    }
    Ok(content)
}

fn anthropic_request_body(
    request: &ModelRequest,
    mut messages: Vec<Value>,
) -> Result<Value, String> {
    let user_content = anthropic_user_content(request)?;
    if !user_content.is_empty() {
        messages.push(json!({"role": "user", "content": user_content}));
    }
    Ok(json!({
        "model": request.model,
        "max_tokens": request.max_output_tokens,
        "system": request.instructions,
        "messages": messages,
        "tools": provider_tools(&request.tools, true),
    }))
}

fn parse_anthropic_response(
    value: Value,
    names: &HashMap<String, String>,
    mut prior_messages: Vec<Value>,
) -> Result<ModelResponse, String> {
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "Claude のレスポンス形式が不正です".to_string())?;
    let mut texts = Vec::new();
    let mut calls = Vec::new();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    texts.push(text.to_string());
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| "Claude のツール呼び出し ID が不正です".to_string())?;
                let safe_name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Claude のツール名が不正です".to_string())?;
                let arguments = block
                    .get("input")
                    .and_then(Value::as_object)
                    .cloned()
                    .ok_or_else(|| "Claude のツール引数が不正です".to_string())?;
                calls.push(ModelToolCall {
                    id: id.to_string(),
                    name: canonical_tool_name(safe_name, names)?.to_string(),
                    arguments,
                });
            }
            _ => {}
        }
    }

    let usage = value.get("usage").and_then(Value::as_object);
    let input_tokens = usage
        .and_then(|item| item.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|item| item.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let continuation = if calls.is_empty() {
        None
    } else {
        prior_messages.push(json!({"role": "assistant", "content": content}));
        Some(serialize_continuation(&ModelContinuation::Anthropic {
            messages: prior_messages,
        })?)
    };

    Ok(ModelResponse {
        text: texts.join("\n"),
        calls,
        input_tokens,
        output_tokens,
        continuation,
    })
}

fn format_http_error(provider: ModelProvider, status: reqwest::StatusCode) -> String {
    let provider_name = match provider {
        ModelProvider::Openai => "GPT",
        ModelProvider::Anthropic => "Claude",
    };
    format!("{provider_name} APIエラー {status}: APIサーバーからエラーが返されました")
}

async fn send_json_request(
    client: &reqwest::Client,
    provider: ModelProvider,
    api_key: &str,
    body: &Value,
) -> Result<Value, String> {
    let request = match provider {
        ModelProvider::Openai => client
            .post(OPENAI_RESPONSES_URL)
            .bearer_auth(api_key)
            .header("content-type", "application/json"),
        ModelProvider::Anthropic => client
            .post(ANTHROPIC_MESSAGES_URL)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json"),
    };
    let response = request.json(body).send().await.map_err(|error| {
        if error.is_timeout() {
            format!("モデルへのリクエストが{MODEL_REQUEST_TIMEOUT_SECS}秒でタイムアウトしました")
        } else {
            format!("モデルへのリクエストに失敗しました: {error}")
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format_http_error(provider, status));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("モデルのレスポンスを解析できません: {error}"))
}

#[tauri::command]
pub async fn request_model(
    window: tauri::Window,
    claude_key_state: tauri::State<'_, ApiKeyState>,
    gpt_key_state: tauri::State<'_, GptApiKeyState>,
    request: ModelRequest,
) -> Result<ModelResponse, String> {
    ensure_main_window(&window)?;
    validate_request(&request)?;
    let names = tool_name_map(&request.tools)?;
    let continuation = parse_continuation(request.continuation.as_deref())?;
    let api_key = match request.provider {
        ModelProvider::Openai => read_gpt_api_key(&gpt_key_state)?,
        ModelProvider::Anthropic => read_api_key(&claude_key_state)?,
    };
    let client = reqwest::Client::builder()
        .timeout(request_timeout())
        .build()
        .map_err(|error| format!("HTTPクライアントを初期化できません: {error}"))?;

    match request.provider {
        ModelProvider::Openai => {
            let previous_response_id = match continuation {
                None => None,
                Some(ModelContinuation::Openai {
                    previous_response_id,
                }) => Some(previous_response_id),
                Some(ModelContinuation::Anthropic { .. }) => {
                    return Err("別のプロバイダーの継続情報は使用できません".to_string())
                }
            };
            let body = openai_request_body(&request, previous_response_id.as_deref())?;
            let value = send_json_request(&client, request.provider, &api_key, &body).await?;
            parse_openai_response(value, &names)
        }
        ModelProvider::Anthropic => {
            let mut messages = match continuation {
                None => Vec::new(),
                Some(ModelContinuation::Anthropic { messages }) => messages,
                Some(ModelContinuation::Openai { .. }) => {
                    return Err("別のプロバイダーの継続情報は使用できません".to_string())
                }
            };
            let body = anthropic_request_body(&request, messages.clone())?;
            messages = body
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "Claude の会話情報を構築できません".to_string())?;
            let value = send_json_request(&client, request.provider, &api_key, &body).await?;
            parse_anthropic_response(value, &names, messages)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_tool() -> ModelTool {
        ModelTool {
            name: "document.get_image".to_string(),
            description: "画像を取得".to_string(),
            parameters: Map::from_iter([("type".to_string(), Value::String("object".to_string()))]),
        }
    }

    fn names() -> HashMap<String, String> {
        tool_name_map(&[test_tool()]).unwrap()
    }

    fn test_request(provider: ModelProvider) -> ModelRequest {
        ModelRequest {
            provider,
            model: "test-model".to_string(),
            instructions: "作業してください".to_string(),
            text: String::new(),
            image_data_url: Some("data:image/png;base64,AAAA".to_string()),
            reference_images: vec![],
            reasoning_effort: None,
            tools: vec![test_tool()],
            max_output_tokens: 1024,
            continuation: None,
            tool_results: vec![ModelToolResult {
                call_id: "call_1".to_string(),
                output: json!({"ok":true}),
                is_error: false,
            }],
        }
    }

    #[test]
    fn timeout_is_bounded_to_two_minutes() {
        assert_eq!(request_timeout(), Duration::from_secs(120));
    }

    #[test]
    fn references_are_labeled_images_for_both_providers() {
        let mut request = test_request(ModelProvider::Openai);
        request.reference_images = vec![ModelReferenceImage {
            name: "目標.png".to_string(),
            data_url: "data:image/png;base64,aGVsbG8=".to_string(),
        }];
        request.reasoning_effort = Some(ReasoningEffort::High);
        let body = openai_request_body(&request, Some("resp_1")).unwrap();
        let content = &body["input"][1]["content"];
        assert_eq!(content[0]["image_url"], "data:image/png;base64,AAAA");
        assert!(content[1]["text"]
            .as_str()
            .unwrap()
            .contains("お手本（目標の完成像）: 目標.png"));
        assert_eq!(content[2]["image_url"], "data:image/png;base64,aGVsbG8=");
        assert_eq!(content[2]["detail"], "high");
        assert_eq!(body["reasoning"]["effort"], "high");

        let content = anthropic_user_content(&request).unwrap();
        assert_eq!(content[1]["source"]["data"], "AAAA");
        assert!(content[2]["text"]
            .as_str()
            .unwrap()
            .contains("お手本（目標の完成像）: 目標.png"));
        assert_eq!(content[3]["type"], "image");
        assert_eq!(content[3]["source"]["data"], "aGVsbG8=");
        assert!(anthropic_request_body(&request, vec![])
            .unwrap()
            .get("reasoning")
            .is_none());
    }

    #[test]
    fn rejects_excessive_or_invalid_reference_images() {
        let mut request = test_request(ModelProvider::Openai);
        request.tool_results.clear();
        for _ in 0..3 {
            request.reference_images.push(ModelReferenceImage {
                name: "目標.png".to_string(),
                data_url: "data:image/png;base64,AAAA".to_string(),
            });
        }
        assert!(validate_request(&request).is_ok());
        request.reference_images.push(ModelReferenceImage {
            name: "余分.png".to_string(),
            data_url: "data:image/png;base64,AAAA".to_string(),
        });
        assert!(validate_request(&request).is_err());
        request.reference_images.pop();
        request.reference_images[0].data_url = "https://example.test/target.png".to_string();
        assert!(validate_request(&request).is_err());
        request.reference_images[0].data_url =
            format!("data:image/png;base64,{}", "A".repeat(2_810_300));
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn tool_name_encoding_round_trips_through_request_map() {
        let names = names();
        assert_eq!(
            canonical_tool_name("document__get_image", &names).unwrap(),
            "document.get_image"
        );
    }

    #[test]
    fn image_data_url_rejects_invalid_and_unsupported_values() {
        assert!(parse_image_data_url("https://example.test/image.png").is_err());
        assert!(parse_image_data_url("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert_eq!(
            parse_image_data_url("data:image/png;base64,AAAA").unwrap(),
            ("image/png", "AAAA")
        );
    }

    #[test]
    fn openai_continuation_sends_tool_output_and_fresh_image() {
        let request = test_request(ModelProvider::Openai);
        let body = openai_request_body(&request, Some("resp_1")).unwrap();
        assert_eq!(body["previous_response_id"], "resp_1");
        assert_eq!(body["input"][0]["type"], "function_call_output");
        assert_eq!(body["input"][0]["call_id"], "call_1");
        assert_eq!(body["input"][1]["content"][0]["type"], "input_image");
        assert_eq!(body["tools"][0]["name"], "document__get_image");
    }

    #[test]
    fn anthropic_continuation_sends_tool_result_and_fresh_image_in_one_user_turn() {
        let request = test_request(ModelProvider::Anthropic);
        let body = anthropic_request_body(
            &request,
            vec![json!({"role":"assistant","content":[{"type":"tool_use","id":"call_1","name":"document__get_image","input":{}}]})],
        )
        .unwrap();
        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(body["messages"][1]["content"][0]["type"], "tool_result");
        assert_eq!(body["messages"][1]["content"][1]["type"], "image");
        assert_eq!(body["tools"][0]["name"], "document__get_image");
    }

    #[test]
    fn parses_openai_text_calls_usage_and_continuation() {
        let response = parse_openai_response(
            json!({
                "id": "resp_1",
                "output": [
                    {"type":"message","content":[{"type":"output_text","text":"確認しました"}]},
                    {"type":"function_call","call_id":"call_1","name":"document__get_image","arguments":"{\"scale\":0.5}"}
                ],
                "usage":{"input_tokens":12,"output_tokens":7}
            }),
            &names(),
        )
        .unwrap();
        assert_eq!(response.text, "確認しました");
        assert_eq!(response.input_tokens, 12);
        assert_eq!(response.output_tokens, 7);
        assert_eq!(response.calls[0].name, "document.get_image");
        assert_eq!(response.calls[0].arguments["scale"], json!(0.5));
        assert!(response.continuation.is_some());
    }

    #[test]
    fn rejects_invalid_openai_tool_arguments() {
        let error = parse_openai_response(
            json!({
                "id":"resp_1",
                "output":[{"type":"function_call","call_id":"call_1","name":"document__get_image","arguments":"[]"}]
            }),
            &names(),
        )
        .unwrap_err();
        assert_eq!(error, "GPT のツール引数を解析できません");
    }

    #[test]
    fn parses_anthropic_calls_and_preserves_assistant_blocks() {
        let response = parse_anthropic_response(
            json!({
                "content":[
                    {"type":"text","text":"取得します"},
                    {"type":"tool_use","id":"toolu_1","name":"document__get_image","input":{"scale":1}}
                ],
                "usage":{"input_tokens":21,"output_tokens":9}
            }),
            &names(),
            vec![json!({"role":"user","content":[{"type":"text","text":"見て"}]})],
        )
        .unwrap();
        assert_eq!(response.calls[0].name, "document.get_image");
        let continuation = parse_continuation(response.continuation.as_deref())
            .unwrap()
            .unwrap();
        match continuation {
            ModelContinuation::Anthropic { messages } => {
                assert_eq!(messages.len(), 2);
                assert_eq!(messages[1]["role"], "assistant");
            }
            _ => panic!("expected Anthropic continuation"),
        }
    }

    #[test]
    fn http_error_does_not_include_response_body() {
        let error = format_http_error(ModelProvider::Openai, reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(
            error,
            "GPT APIエラー 400 Bad Request: APIサーバーからエラーが返されました"
        );
    }

    #[test]
    fn rejects_incomplete_openai_response() {
        let error = parse_openai_response(
            json!({"id":"resp_1","status":"incomplete","output":[]}),
            &names(),
        )
        .unwrap_err();
        assert!(error.contains("完了しませんでした"));
    }

    #[test]
    fn cropped_tool_images_are_sent_as_images_to_both_providers() {
        let mut request = test_request(ModelProvider::Openai);
        request.tool_results[0].output = json!({
            "dataUrl":"data:image/png;base64,aGVsbG8=", "width":12, "height":8,
            "region":{"x":20,"y":30,"width":12,"height":8}
        });
        let input = openai_input(&request).unwrap();
        let output = input[0]["output"].as_str().unwrap();
        assert!(!output.contains("base64"));
        assert!(output.contains("region"));
        assert_eq!(input[1]["content"][1]["type"], "input_image");
        assert_eq!(
            input[1]["content"][1]["image_url"],
            "data:image/png;base64,aGVsbG8="
        );
        let content = anthropic_user_content(&request).unwrap();
        assert_eq!(content[2]["type"], "image");
        assert_eq!(content[2]["source"]["data"], "aGVsbG8=");
    }
}
