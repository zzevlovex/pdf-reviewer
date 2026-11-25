import { useEffect, useRef, useState } from 'react';
import { extractPdfText, toBase64 } from './lib/pdfText.js';
import { generateReviewerData } from './lib/generate.js';
import { renderReviewerPdf } from './lib/renderPdf.js';
import { loadKeys, saveKeys } from './lib/keys.js';
import * as I from './Icons.jsx';

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const STAGES = ['Read PDFs', 'AI writes reviewer', 'Build PDF'];

const SECTIONS = [
  { Icon: I.Book, title: 'Concept summary', text: 'Topic-by-topic study notes with the key words highlighted.' },
  { Icon: I.List, title: 'Key terms', text: 'Every term and definition from the handout, in one table.' },
  { Icon: I.Puzzle, title: 'Scenario questions', text: 'Situational multiple choice, plus an answer key with reasons.' },
];

const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function App() {
  const [keys, setKeys] = useState(loadKeys);
  const [showSettings, setShowSettings] = useState(() => !loadKeys().gemini);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | working | done
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null); // { message, details? }
  const [result, setResult] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (phase !== 'working') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => () => result?.url && URL.revokeObjectURL(result.url), [result]);

  function addFiles(list) {
    setError(null);
    const next = [...files];
    const problems = [];
    for (const f of list) {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) problems.push(`"${f.name}" is not a PDF.`);
      else if (f.size > MAX_BYTES) problems.push(`"${f.name}" is larger than 20 MB.`);
      else if (next.length >= MAX_FILES) problems.push(`You can add up to ${MAX_FILES} PDFs at a time.`);
      else if (!next.some((n) => n.name === f.name && n.size === f.size)) next.push(f);
    }
    setFiles(next);
    if (problems.length) setError({ message: [...new Set(problems)].join(' ') });
  }

  async function generate() {
    if (!keys.gemini && !keys.groq) {
      setShowSettings(true);
      return;
    }
    setPhase('working');
    setError(null);
    setResult(null);
    setStage(0);
    const t0 = Date.now();
    setStartedAt(t0);
    setElapsed(0);
    try {
      const handouts = [];
      for (const [i, f] of files.entries()) {
        setMessage(`Reading ${f.name} (${i + 1} of ${files.length})`);
        const bytes = await f.arrayBuffer();
        let info;
        try {
          info = await extractPdfText(bytes);
        } catch {
          throw new Error(`"${f.name}" could not be opened. It may be damaged or password-protected.`);
        }
        handouts.push({ name: f.name, bytes, base64: toBase64(bytes), ...info });
      }

      setStage(1);
      const data = await generateReviewerData(handouts, keys, ({ message: m }) => setMessage(m));

      setStage(2);
      setMessage('Designing your PDF');
      const blob = await renderReviewerPdf(data, { fileNames: files.map((f) => f.name) });
      const base = (data.titles[0] || files[0].name.replace(/\.pdf$/i, '')).replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 70);
      setResult({
        url: URL.createObjectURL(blob),
        name: `${base || 'Handout'} - Reviewer.pdf`,
        counts: { topics: data.topics.length, terms: data.terms.length, scenarios: data.scenarios.length },
        models: data.models,
        seconds: Math.round((Date.now() - t0) / 1000),
      });
      setPhase('done');
    } catch (err) {
      setError({ message: err.message, details: err.details });
      setPhase('idle');
    }
  }

  function startOver() {
    setResult(null);
    setFiles([]);
    setError(null);
    setPhase('idle');
  }

  const ready = Boolean(keys.gemini || keys.groq);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><I.Book size={18} /></span>
          <span className="brand-name">Reviewer<span>Studio</span></span>
        </div>
        <button className="btn-quiet" onClick={() => setShowSettings(true)}>
          <span className={`status-dot ${ready ? 'on' : ''}`} />
          <I.Gear size={18} /> <span className="hide-sm">AI keys</span>
        </button>
      </header>

      <main className="layout">
        <section>
          <p className="eyebrow">Free AI exam reviewer</p>
          <h1>Turn handouts into a reviewer you can actually study from.</h1>
          <p className="lead">
            Drop your module PDFs. The AI pulls out every key term, writes topic-by-topic notes with highlights,
            and makes scenario questions like the ones on your exam.
          </p>

          {phase === 'done' && result && (
            <div className="panel result">
              <div className="result-head">
                <span className="badge-ok"><I.Check size={20} /></span>
                <div className="grow">
                  <h2>Your reviewer is ready</h2>
                  <p className="sub">{result.name}</p>
                </div>
              </div>
              <div className="stats">
                <div><strong>{result.counts.topics}</strong><span>topics</span></div>
                <div><strong>{result.counts.terms}</strong><span>key terms</span></div>
                <div><strong>{result.counts.scenarios}</strong><span>scenarios</span></div>
              </div>
              <div className="actions">
                <a className="btn btn-primary" href={result.url} download={result.name}><I.Download size={18} /> Download PDF</a>
                <a className="btn btn-secondary" href={result.url} target="_blank" rel="noreferrer"><I.External size={18} /> Open</a>
              </div>
              <p className="fine">Written by {result.models.join(', ')} in {clock(result.seconds)}.</p>
              <button className="btn btn-ghost" onClick={startOver}>Make another reviewer</button>
            </div>
          )}

          {phase === 'working' && (
            <div className="panel working" role="status" aria-live="polite">
              <div className="working-head">
                <div className="spinner" />
                <div className="grow">
                  <h2>{STAGES[stage]}</h2>
                  <p className="sub">{message}</p>
                </div>
                <span className="timer">{clock(elapsed)}</span>
              </div>
              <div className="progress"><div style={{ width: `${((stage + 0.5) / STAGES.length) * 100}%` }} /></div>
              <ol className="stages">
                {STAGES.map((s, i) => (
                  <li key={s} className={i < stage ? 'done' : i === stage ? 'active' : ''}>
                    <span className="num">{i < stage ? <I.Check size={14} /> : i + 1}</span>{s}
                  </li>
                ))}
              </ol>
              <p className="fine">Most handouts take 1 to 3 minutes. Keep this page open.</p>
            </div>
          )}

          {phase === 'idle' && (
            <>
              <div
                className={`dropzone ${dragging ? 'over' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => input.current.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              >
                <span className="drop-icon"><I.Upload size={26} /></span>
                <strong className="show-lg">{dragging ? 'Drop to add' : 'Drag & drop handout PDFs'}</strong>
                <strong className="show-sm">Tap to choose handout PDFs</strong>
                <span className="drop-sub"><span className="show-lg">or <em>browse files</em> · </span>up to {MAX_FILES} PDFs, 20 MB each</span>
                <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>

              {files.length > 0 && (
                <div className="panel files">
                  <div className="files-head">
                    <span>{files.length} {files.length === 1 ? 'file' : 'files'} · {fmtSize(files.reduce((s, f) => s + f.size, 0))}</span>
                    <button className="link" onClick={() => setFiles([])}>Clear</button>
                  </div>
                  <ul>
                    {files.map((f, i) => (
                      <li key={f.name + f.size}>
                        <span className="file-icon"><I.FileIcon size={18} /></span>
                        <span className="file-name" title={f.name}>{f.name}</span>
                        <span className="file-size">{fmtSize(f.size)}</span>
                        <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                          <I.X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button className="btn btn-primary btn-block" disabled={files.length === 0} onClick={generate}>
                <I.Sparkle size={18} /> Generate reviewer
              </button>
              {!ready && <p className="fine center">Add your free AI key first. It takes about a minute.</p>}
            </>
          )}

          {error && (
            <div className="alert" role="alert">
              <I.Alert size={20} />
              <div>
                <strong>{error.message}</strong>
                {error.details?.length > 0 && (
                  <details>
                    <summary>Details</summary>
                    <ul>{error.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </details>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="side">
          <div className="panel">
            <h3>What's in your reviewer</h3>
            <ul className="features">
              {SECTIONS.map(({ Icon, title, text }) => (
                <li key={title}>
                  <span className="feature-icon"><Icon size={18} /></span>
                  <div><strong>{title}</strong><p>{text}</p></div>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h3>AI engine</h3>
            <ul className="engine">
              <li><span className={`status-dot ${keys.gemini ? 'on' : ''}`} /> <span className="grow">Google Gemini</span><span className="tag">{keys.gemini ? 'Main' : 'Not set'}</span></li>
              <li><span className={`status-dot ${keys.groq ? 'on' : ''}`} /> <span className="grow">Groq</span><span className="tag">{keys.groq ? 'Backup' : 'Not set'}</span></li>
            </ul>
            <p className="fine">If Gemini's free limit runs out, the app switches to Groq on its own. Free, no waiting for resets.</p>
          </div>
        </aside>
      </main>

      {showSettings && (
        <Settings
          keys={keys}
          onClose={() => setShowSettings(false)}
          onSave={(k) => { saveKeys(k); setKeys(k); setShowSettings(false); }}
        />
      )}
    </div>
  );
}

function KeyField({ label, value, onChange, placeholder, prefix, link, linkText, note }) {
  const [show, setShow] = useState(false);
  const warn = value && prefix && !value.trim().startsWith(prefix);
  return (
    <div className="field">
      <div className="field-top">
        <label>{label}</label>
        <a href={link} target="_blank" rel="noreferrer">{linkText} <I.External size={13} /></a>
      </div>
      <div className="input-wrap">
        <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="off" spellCheck="false"
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="icon-btn" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}><I.Eye size={16} /></button>
      </div>
      <p className={`fine ${warn ? 'warn' : ''}`}>{warn ? `This doesn't look like a ${label} (they start with "${prefix}").` : note}</p>
    </div>
  );
}

function Settings({ keys, onClose, onSave }) {
  const [draft, setDraft] = useState(keys);
  const canClose = Boolean(keys.gemini || keys.groq);
  return (
    <div className="modal-backdrop" onClick={() => canClose && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="feature-icon"><I.Key size={18} /></span>
          <div className="grow">
            <h2 id="settings-title">Connect the free AI</h2>
            <p className="sub">One-time setup on each device. No credit card.</p>
          </div>
          {canClose && <button className="icon-btn" aria-label="Close" onClick={onClose}><I.X size={18} /></button>}
        </div>

        <KeyField
          label="Gemini API key" prefix="AIza" placeholder="AIza..."
          link="https://aistudio.google.com/apikey" linkText="Get a free key"
          note="Main AI. Sign in with Google, click Create API key, paste it here."
          value={draft.gemini} onChange={(gemini) => setDraft({ ...draft, gemini })}
        />
        <KeyField
          label="Groq API key" prefix="gsk_" placeholder="gsk_..."
          link="https://console.groq.com/keys" linkText="Get a free key"
          note="Backup AI for when Gemini's daily free limit runs out. Recommended."
          value={draft.groq} onChange={(groq) => setDraft({ ...draft, groq })}
        />

        <p className="fine privacy">Keys are saved only in this browser and are sent only to Google and Groq.</p>
        <button className="btn btn-primary btn-block" disabled={!draft.gemini.trim() && !draft.groq.trim()} onClick={() => onSave(draft)}>
          Save keys
        </button>
      </div>
    </div>
  );
}
