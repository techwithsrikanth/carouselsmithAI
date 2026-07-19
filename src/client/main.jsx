import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./styles.css";

const api = {
  async request(path, options = {}) {
    const token = localStorage.getItem("token");
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  },
  async download(path) {
    const token = localStorage.getItem("token");
    const response = await fetch(`/api${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Download failed: ${response.status}`);
    }
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "carousel.zip";
    return { blob: await response.blob(), filename };
  }
};

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readFileAsStyleUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        data: dataUrl.split(",")[1] || ""
      });
    };
    reader.readAsDataURL(file);
  });
}

function Logo({ compact = false }) {
  return (
    <span className={`logo ${compact ? "compact" : ""}`}>
      <img className="logo-mark" src="/favicon.svg" alt="" aria-hidden="true" />
      {!compact && <span className="logo-text">Carouselsmith AI</span>}
    </span>
  );
}

const defaultComposerInput = {
  prompt: "How AI agents are changing content operations for small agencies",
  instagramHandle: "@creatorstudio",
  sourceText: "",
  totalSlides: 7
};

function Landing() {
  return (
    <main className="landing">
      <nav className="nav">
        <Logo />
        <div>
          <Link to="/auth">Sign in</Link>
          <Link className="button" to="/dashboard">Open studio</Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Research-first carousel generation</p>
          <h1>Make polished carousels from one prompt.</h1>
          <p>
            Add a topic, URL, PDF, or reference screenshot. Carouselsmith researches the brief,
            keeps the design consistent, and exports ready-to-post slides.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/auth">Start generating</Link>
            <Link className="button" to="/dashboard">Open studio</Link>
          </div>
        </div>
        <div className="hero-example" aria-label="Example carousel workflow">
          <div className="example-brief">
            <span>Prompt</span>
            <strong>Bengaluru's top 5 events this week</strong>
            <p>Use uploaded design references, verify dates from trusted sources, and make 6 slides.</p>
          </div>
          <div className="example-steps">
            <span>Research</span>
            <span>Style match</span>
            <span>PNG export</span>
          </div>
          <div className="example-slide">
            <small>1/6</small>
            <strong>5 things happening in Bengaluru</strong>
            <p>Verified picks, realistic visuals, clean typography.</p>
          </div>
        </div>
      </section>
      <section className="feature-row">
        {["Google-grounded research", "Creator style learning", "Direct social publishing"].map((item) => (
          <article key={item}><strong>{item}</strong><p>Real adapters, explicit 503s, and no prompt echoing.</p></article>
        ))}
      </section>
    </main>
  );
}

function Auth() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api.request(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) });
      localStorage.setItem("token", data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <Link to="/"><Logo /></Link>
        <h1>{mode === "signin" ? "Welcome back" : "Create your studio"}</h1>
        <label>Email<input value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" value={password} autoComplete={mode === "signin" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="button primary">{mode === "signin" ? "Sign in" : "Sign up"}</button>
        <button type="button" className="linkish" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Need an account?" : "Already have an account?"}
        </button>
      </form>
    </main>
  );
}

function SlideDeck({ result, loading }) {
  const [active, setActive] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState("");
  const slides = result?.slides || [];
  const images = new Map((result?.images_generated || []).map((image) => [image.slide_number, image]));
  const slide = slides[active];

  if (loading) {
    return <section className="deck loading"><span className="pulse" /><h2>Researching sources and building the deck...</h2></section>;
  }
  if (!slide) {
    return <section className="deck empty"><h2>Your generated carousel appears here.</h2><p>Start with a topic, handle, and optional notes.</p></section>;
  }

  const image = images.get(slide.slide_number);

  async function downloadAllSlides() {
    if (!result?.carousel_id) return;
    setDownloadMessage("");
    try {
      const file = await api.download(`/carousels/${result.carousel_id}/download`);
      saveBlob(file.blob, file.filename);
    } catch (err) {
      setDownloadMessage(err.message);
    }
  }

  return (
    <section className="deck">
      <div className="section-head">
        <span>Preview</span>
        <strong>{slides.length} slides</strong>
      </div>
      <div className="slide-frame">
        {image?.url ? <img src={image.url} alt={slide.title} /> : (
          <div className="text-slide">
            <span>{String(slide.slide_number).padStart(2, "0")}</span>
            <h2>{slide.title}</h2>
            <p>{slide.body}</p>
            <small>{slide.visual_direction}</small>
          </div>
        )}
      </div>
      <div className="thumbs">
        {slides.map((item, index) => (
          <button key={item.slide_number} className={index === active ? "active" : ""} onClick={() => setActive(index)}>
            {item.slide_number}
          </button>
        ))}
      </div>
      <div className="deck-actions">
        <button className="button primary" type="button" disabled={!result?.carousel_id} onClick={downloadAllSlides}>Download ZIP</button>
        <a className="button" href={image?.url || "#"} download aria-disabled={!image?.url}>Download active slide</a>
      </div>
      {downloadMessage && <p className="error">{downloadMessage}</p>}
    </section>
  );
}

function Insights({ result }) {
  const [tab, setTab] = useState("Research");
  const data = useMemo(() => ({
    Research: result?.research_summary || [],
    Plan: result?.content_plan || {},
    Sources: result?.sources_used || [],
    "Fact-check": result?.fact_check || [],
    Caption: { caption: result?.caption, hashtags: result?.hashtags }
  }), [result]);

  return (
    <section className="insights">
      <div className="section-head">
        <span>Intelligence</span>
        <strong>{tab}</strong>
      </div>
      <div className="tabs">{Object.keys(data).map((name) => <button className={tab === name ? "active" : ""} onClick={() => setTab(name)} key={name}>{name}</button>)}</div>
      <pre>{JSON.stringify(data[tab], null, 2)}</pre>
    </section>
  );
}

function Composer({ draftInput, onResult, onLoading }) {
  const [prompt, setPrompt] = useState(defaultComposerInput.prompt);
  const [handle, setHandle] = useState(defaultComposerInput.instagramHandle);
  const [sourceText, setSourceText] = useState(defaultComposerInput.sourceText);
  const [totalSlides, setTotalSlides] = useState(defaultComposerInput.totalSlides);
  const [styleUploads, setStyleUploads] = useState([]);
  const [error, setError] = useState("");
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const promptExamples = [
    "https://techcrunch.com/2026/07/17/databricks-hits-188b-valuation-extending-its-run-as-ais-favorite-second-act/",
    "Top 10 VC firms in the world and what makes each one different",
    "Turn this market report into a story-driven carousel for founders",
    "Explain why AI agents are changing how small teams create content"
  ];

  useEffect(() => {
    const next = draftInput || defaultComposerInput;
    setPrompt(next.prompt || defaultComposerInput.prompt);
    setHandle(next.instagramHandle || defaultComposerInput.instagramHandle);
    setSourceText(next.sourceText || "");
    setTotalSlides(next.totalSlides || defaultComposerInput.totalSlides);
    setStyleUploads([]);
    setError("");
  }, [draftInput]);

  async function addStyleFiles(fileList) {
    setError("");
    const files = [...fileList].filter((file) => ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type));
    if (!files.length) {
      setError("Upload PNG, JPG, WebP, or PDF carousel references.");
      return;
    }
    const oversized = files.find((file) => file.size > 8 * 1024 * 1024);
    if (oversized) {
      setError(`${oversized.name} is larger than 8 MB.`);
      return;
    }
    const nextUploads = await Promise.all(files.slice(0, 8).map(readFileAsStyleUpload));
    setStyleUploads((current) => [...current, ...nextUploads].slice(0, 8));
  }

  async function generate(event) {
    event.preventDefault();
    setError("");
    onLoading(true);
    try {
      const result = await api.request("/carousel/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, instagramHandle: handle, sourceText, totalSlides, styleUploads })
      });
      onResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      onLoading(false);
    }
  }

  async function improvePrompt() {
    setError("");
    setImprovingPrompt(true);
    try {
      const data = await api.request("/prompt/improve", {
        method: "POST",
        body: JSON.stringify({ prompt, instagramHandle: handle, sourceText, totalSlides })
      });
      setPrompt(data.improved_prompt);
    } catch (err) {
      setError(err.message);
    } finally {
      setImprovingPrompt(false);
    }
  }

  return (
    <form className="composer" onSubmit={generate}>
      <div className="section-head">
        <span>Composer</span>
        <strong>{styleUploads.length ? `${styleUploads.length} ref` : "No ref"}</strong>
      </div>
      <label>
        <span className="label-row">
          Topic
          <button className="linkish" type="button" disabled={improvingPrompt || !prompt.trim()} onClick={improvePrompt}>
            {improvingPrompt ? "Improvising..." : "Improvise prompt"}
          </button>
        </span>
        <textarea value={prompt} rows="4" onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <div className="prompt-examples" aria-label="Example prompts">
        {promptExamples.map((example) => (
          <button type="button" key={example} onClick={() => setPrompt(example)}>
            {example}
          </button>
        ))}
      </div>
      <label>Instagram handle<input value={handle} onChange={(event) => setHandle(event.target.value)} /></label>
      <label>Optional source text<textarea value={sourceText} rows="4" onChange={(event) => setSourceText(event.target.value)} /></label>
      <label>Slides<input type="number" min="4" max="12" value={totalSlides} onChange={(event) => setTotalSlides(event.target.value)} /></label>
      <label
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addStyleFiles(event.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          onChange={(event) => addStyleFiles(event.target.files)}
        />
        <strong>Upload carousel references</strong>
        <span>Drop screenshots or PDFs here. Gemini will learn the visual style before generating.</span>
      </label>
      {styleUploads.length > 0 && (
        <div className="upload-list">
          {styleUploads.map((file, index) => (
            <span key={`${file.name}-${index}`}>
              {file.name}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setStyleUploads(styleUploads.filter((_, itemIndex) => itemIndex !== index))}>x</button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="button primary">Generate carousel</button>
    </form>
  );
}

function PublishPanel({ result }) {
  const [platforms, setPlatforms] = useState(["linkedin"]);
  const [message, setMessage] = useState("");
  const [caption, setCaption] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    setCaption(result ? `${result.caption || ""}\n\n${(result.hashtags || []).join(" ")}`.trim() : "");
  }, [result]);

  async function publish() {
    setMessage("");
    try {
      const data = await api.request("/publish", {
        method: "POST",
        body: JSON.stringify({ carouselId: result?.carousel_id, platforms, caption })
      });
      setMessage(JSON.stringify(data.results, null, 2));
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function copyCaption() {
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(caption);
      setCopyMessage("Caption copied.");
    } catch {
      setCopyMessage("Select the caption text and copy it manually.");
    }
  }

  return (
    <section className="publish">
      <div className="section-head">
        <span>Publish</span>
        <strong>{result ? "Ready" : "Draft"}</strong>
      </div>
      <textarea
        rows="6"
        value={caption}
        placeholder="Caption auto-fills after generation, then you can edit it before publishing."
        onChange={(event) => setCaption(event.target.value)}
      />
      <div className="publish-actions">
        <button className="button" type="button" disabled={!caption} onClick={copyCaption}>Copy caption</button>
        {result?.carousel_id && (
          <button className="button primary" type="button" onClick={async () => {
            setMessage("");
            try {
              const file = await api.download(`/carousels/${result.carousel_id}/download`);
              saveBlob(file.blob, file.filename);
            } catch (err) {
              setMessage(err.message);
            }
          }}>Download ZIP</button>
        )}
      </div>
      {copyMessage && <p className="success">{copyMessage}</p>}
      <label><input type="checkbox" checked={platforms.includes("linkedin")} onChange={(event) => setPlatforms(event.target.checked ? ["linkedin", ...platforms] : platforms.filter((p) => p !== "linkedin"))} /> LinkedIn</label>
      <label><input type="checkbox" checked={platforms.includes("instagram")} onChange={(event) => setPlatforms(event.target.checked ? ["instagram", ...platforms] : platforms.filter((p) => p !== "instagram"))} /> Instagram</label>
      <button className="button" disabled={!result} onClick={publish}>Publish selected</button>
      {message && <pre>{message}</pre>}
    </section>
  );
}

function Dashboard() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("token")));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [draftInput, setDraftInput] = useState(defaultComposerInput);

  useEffect(() => {
    if (!authed) return;
    api.request("/carousels").then((data) => setHistory(data.carousels)).catch(() => setAuthed(false));
  }, [authed, result]);

  async function openHistoryItem(item) {
    setLoading(true);
    try {
      const data = await api.request(`/carousels/${item.id}`);
      setResult(data.carousel);
      setActiveHistoryId(item.id);
      setDraftInput(data.carousel.generation_input || { ...defaultComposerInput, prompt: data.carousel.prompt, totalSlides: data.carousel.slides?.length || 7 });
    } finally {
      setLoading(false);
    }
  }

  function createNewCarousel() {
    setResult(null);
    setActiveHistoryId(null);
    setDraftInput({ ...defaultComposerInput });
  }

  async function deleteHistoryItem(event, item) {
    event.stopPropagation();
    await api.request(`/carousels/${item.id}`, { method: "DELETE" });
    setHistory((current) => current.filter((historyItem) => historyItem.id !== item.id));
    if (activeHistoryId === item.id) {
      setActiveHistoryId(null);
      setResult(null);
    }
  }

  if (!authed) return <Navigate to="/auth" />;
  return (
    <main className="studio">
      <aside className="history">
        <div className="history-title">
          <Logo />
          <span>History</span>
        </div>
        <button className="button primary new-carousel" onClick={createNewCarousel}>Create new carousel</button>
        {history.length === 0 && <p>No saved runs yet.</p>}
        {history.map((item) => (
          <button
            className={`history-item ${activeHistoryId === item.id ? "active" : ""}`}
            key={item.id}
            title={item.prompt}
            onClick={() => openHistoryItem(item)}
          >
            <span>{item.prompt_summary || "Untitled idea"}</span>
            <small>{item.total_slides} slides</small>
            <em
              role="button"
              tabIndex="0"
              aria-label={`Delete ${item.prompt_summary || "carousel"}`}
              onClick={(event) => deleteHistoryItem(event, item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") deleteHistoryItem(event, item);
              }}
            >
              Delete
            </em>
          </button>
        ))}
      </aside>
      <section className="workbench">
        <header>
          <div>
            <Link to="/"><Logo /></Link>
            <span>Research, design, publish</span>
          </div>
          <button className="button ghost" onClick={() => { localStorage.removeItem("token"); setAuthed(false); }}>Sign out</button>
        </header>
        <div className="grid">
          <Composer draftInput={draftInput} onResult={setResult} onLoading={setLoading} />
          <SlideDeck result={result} loading={loading} />
          <Insights result={result} />
          <PublishPanel result={result} />
        </div>
      </section>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<App />);
