import { useState } from "react";
import type { PaintApi } from "../../core/paintApi";
import { Button } from "../../ui/primitives";

export function AgentApiInspector({ api, disabled }: { api: PaintApi; disabled: boolean }) {
  const tools = api.list();
  const [name, setName] = useState("document.get_state");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = tools.find(t => t.name === name);
  return <details className="agent-api-inspector"><summary>機能API（{tools.length}件）</summary>
    <select aria-label="API名" value={name} onChange={e => setName(e.target.value)}>{tools.map(tool => <option key={tool.name}>{tool.name}</option>)}</select>
    <p>{selected?.description}</p>
    <pre>{JSON.stringify(selected?.parameters, null, 2)}</pre>
    <textarea aria-label="API引数" rows={4} value={argumentsText} onChange={e => setArgumentsText(e.target.value)} />
    <Button disabled={disabled || busy} onClick={async () => {
      setBusy(true);
      try {
        const response = await api.execute(name, JSON.parse(argumentsText) as Record<string, unknown>);
        setResult(JSON.stringify(response, (key, value: unknown) => /dataUrl|base64/.test(key) && typeof value === "string" ? `[画像 ${value.length}文字]` : value, 2).slice(0, 10000));
      } catch (error) { setResult(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }}>実行</Button>
    {result && <pre aria-label="API実行結果">{result}</pre>}
  </details>;
}
