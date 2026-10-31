import { useMemo, useState } from "react";
import { IconButton } from "../ui/primitives";

interface Props {
  onClose: () => void;
}

import { DRAWING_GUIDE_ARTICLES as ARTICLES, type GuideArticle } from "../core/drawingGuideArticles";

const CHECK_STORAGE_KEY = "ai-paint-drawing-guide-checks";

function loadChecks(): string[] {
  try {
    const raw = localStorage.getItem(CHECK_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveChecks(ids: string[]) {
  try {
    localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 保存できなくても参照表示は継続する
  }
}

export function DrawingGuideView({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(ARTICLES[0].id);
  const [checked, setChecked] = useState<string[]>(() => loadChecks());

  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    return ARTICLES.filter((article) => {
      const haystack = [
        article.category,
        article.title,
        article.summary,
        ...article.steps,
        ...article.tips,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  const selected =
    filteredArticles.find((article) => article.id === selectedId) ??
    filteredArticles[0] ??
    ARTICLES[0];

  const grouped = useMemo(() => {
    const map = new Map<string, GuideArticle[]>();
    for (const article of filteredArticles) {
      const list = map.get(article.category) ?? [];
      list.push(article);
      map.set(article.category, list);
    }
    return Array.from(map.entries());
  }, [filteredArticles]);

  const toggleStep = (articleId: string, index: number) => {
    const id = `${articleId}:${index}`;
    setChecked((prev) => {
      const next = prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id];
      saveChecks(next);
      return next;
    });
  };

  return (
    <div className="drawing-guide-view" role="dialog" aria-label="描き方参照">
      <div className="drawing-guide-titlebar">
        <div>
          <div className="drawing-guide-title">描き方参照</div>
          <div className="drawing-guide-subtitle">工程と塗りのメモ</div>
        </div>
        <IconButton onClick={onClose} title="閉じる" style={{ width: 22, height: 22 }}>
          ×
        </IconButton>
      </div>

      <div className="drawing-guide-toolbar">
        <input
          className="input drawing-guide-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="検索"
          aria-label="描き方参照を検索"
        />
      </div>

      <div className="drawing-guide-body">
        <nav className="drawing-guide-nav" aria-label="目次">
          <div className="drawing-guide-nav-label">目次</div>
          {grouped.map(([category, articles]) => (
            <div className="drawing-guide-group" key={category}>
              <div className="drawing-guide-category">{category}</div>
              {articles.map((article) => (
                <button
                  key={article.id}
                  className={`drawing-guide-nav-item ${
                    selected.id === article.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedId(article.id)}
                >
                  {article.title}
                </button>
              ))}
            </div>
          ))}
          {filteredArticles.length === 0 && (
            <div className="drawing-guide-empty">該当なし</div>
          )}
        </nav>

        <article className="drawing-guide-article">
          <div className="drawing-guide-article-head">
            <span className="drawing-guide-badge">{selected.category}</span>
            <h2>{selected.title}</h2>
            <p>{selected.summary}</p>
          </div>

          <section>
            <h3>手順</h3>
            <ol className="drawing-guide-steps">
              {selected.steps.map((step, index) => {
                const checkId = `${selected.id}:${index}`;
                return (
                  <li key={checkId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked.includes(checkId)}
                        onChange={() => toggleStep(selected.id, index)}
                      />
                      <span>{step}</span>
                    </label>
                  </li>
                );
              })}
            </ol>
          </section>

          <section>
            <h3>注意点</h3>
            <ul className="drawing-guide-tips">
              {selected.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
