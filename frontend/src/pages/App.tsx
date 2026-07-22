import { BookOpenText, ClipboardList, ExternalLink, LogOut, Search, Shield, UserRound, UsersRound, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, ComponentPropsWithoutRef, Dispatch, ReactNode, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import type { AccessGroup, AccessGroupPayload, AccessRules, AuditEventItem, Audience, DocItem, DocsSection, FormItem, FormTab, HomePage, Session, Soldier, UserAccount, VerificationCodeAdminItem } from "../types";

type View = "me" | "profiles" | "forms" | "docs";
type FormsAdminSheet = "view" | "create" | "edit";
type DocsAdminSheet = "view" | "create";

function emptyDocDraft(sectionId = ""): Omit<DocItem, "id"> {
  return {
    title: "",
    section_id: sectionId,
    audience: "public",
    content: "",
    description: "",
    active: true,
  };
}

const audienceLabel = (audience: Audience, groups: AccessGroup[] = []) => {
  if (audience === "admin") return "Админы";
  if (audience === "instructor") return "Инструкторы";
  if (audience === "officer") return "Оф состав";
  if (audience === "public") return "Для всех";
  const group = groups.find((item) => item.id === audience);
  if (group) return group.title;
  return audience;
};

const emptyAccessRules: AccessRules = {
  groups: [],
  instructors: { ranks: [], specializations: [], positions: [] },
  officers: { ranks: [], specializations: [], positions: [] },
};

type DocumentOutlineItem = {
  id: string;
  level: number;
  text: string;
  line: number;
};

type MarkdownHeadingProps = ComponentPropsWithoutRef<"h1"> & {
  children?: ReactNode;
  node?: { position?: { start?: { line?: number } } };
};

function markdownHeadingText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownHeadingId(value: string) {
  return markdownHeadingText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-") || "section";
}

function extractDocumentOutline(content: string): DocumentOutlineItem[] {
  const usedIds = new Map<string, number>();
  const headings: DocumentOutlineItem[] = [];
  let inCodeBlock = false;

  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    const text = markdownHeadingText(match[2]);
    if (!text) return;
    const baseId = markdownHeadingId(text);
    const count = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, count);
    headings.push({ id: count === 1 ? baseId : `${baseId}-${count}`, level: match[1].length, text, line: index + 1 });
  });
  return headings;
}

function MarkdownHeading({ level, headingIdsByLine, node, children, ...props }: MarkdownHeadingProps & { level: number; headingIdsByLine: Map<number, string> }) {
  const id = headingIdsByLine.get(node?.position?.start?.line ?? -1);
  if (level === 1) return <h1 id={id} {...props}>{children}</h1>;
  if (level === 2) return <h2 id={id} {...props}>{children}</h2>;
  if (level === 3) return <h3 id={id} {...props}>{children}</h3>;
  if (level === 4) return <h4 id={id} {...props}>{children}</h4>;
  if (level === 5) return <h5 id={id} {...props}>{children}</h5>;
  return <h6 id={id} {...props}>{children}</h6>;
}

function MarkdownWithOutline({ content }: { content: string }) {
  const outline = useMemo(() => extractDocumentOutline(content), [content]);
  const headingIdsByLine = useMemo(() => new Map(outline.map((item) => [item.line, item.id])), [outline]);
  const components = useMemo(
    () => ({
      h1: (props: MarkdownHeadingProps) => <MarkdownHeading level={1} headingIdsByLine={headingIdsByLine} {...props} />,
      h2: (props: MarkdownHeadingProps) => <MarkdownHeading level={2} headingIdsByLine={headingIdsByLine} {...props} />,
      h3: (props: MarkdownHeadingProps) => <MarkdownHeading level={3} headingIdsByLine={headingIdsByLine} {...props} />,
      h4: (props: MarkdownHeadingProps) => <MarkdownHeading level={4} headingIdsByLine={headingIdsByLine} {...props} />,
      h5: (props: MarkdownHeadingProps) => <MarkdownHeading level={5} headingIdsByLine={headingIdsByLine} {...props} />,
      h6: (props: MarkdownHeadingProps) => <MarkdownHeading level={6} headingIdsByLine={headingIdsByLine} {...props} />,
    }),
    [headingIdsByLine],
  );

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content || "_Документ пустой._"}</ReactMarkdown>;
}

function parseList(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value: string[]) {
  return value.join("\n");
}

const storageSession = () => {
  const raw = localStorage.getItem("star327_session");
  return raw ? (JSON.parse(raw) as Session) : null;
};

function profileRows(profile: Soldier) {
  return [
    ["Ник", profile.nickname],
    ["Звание", profile.rank],
    ["Номер", profile.number],
    ["Отпуск/Мороз", String(profile.raw["Отпуск/Мороз"] || "")],
    ["Выслуга", profile.service_time],
    ["Должность", profile.position],
    ["Статус", profile.status],
  ].filter(([, value]) => String(value || "").trim());
}

function splitRawRows(profile: Soldier) {
  const entries = Object.entries(profile.raw).filter(([key]) => key !== "Сводка информации" && key !== "Сводка информации:");
  const summaryStart = entries.findIndex(([key]) => key === "Выслуга");
  if (summaryStart < 0) return { details: entries, summary: [] };
  return {
    details: entries.slice(0, summaryStart),
    summary: entries.slice(summaryStart),
  };
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"nickname" | "password">("nickname");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const needsPassword = step === "password";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await api.login(nickname, needsPassword ? password : undefined);
      api.saveSession(session);
      onLogin(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка входа";
      if (message.includes("Нужен правильный пароль")) {
        setStep("password");
        setPassword("");
        setError(needsPassword ? "Неверный пароль" : "");
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function backToNickname() {
    setStep("nickname");
    setPassword("");
    setError("");
  }

  return (
    <main className="login">
      <section className="login-panel">
        <p className="eyebrow">327 Star Corp</p>
        <h1>{needsPassword ? "Введите пароль" : "Батальонный архив"}</h1>
        <form onSubmit={submit} className="login-form">
          {!needsPassword ? (
            <label>
              Никнейм
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Например: CT-3277"
              />
            </label>
          ) : (
            <>
              <label>
                Никнейм
                <input
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={nickname}
                  readOnly
                />
              </label>
              <label>
                Пароль
                <input
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoFocus
                />
              </label>
            </>
          )}
          {error && <div className="alert">{error}</div>}
          <button disabled={loading || !nickname.trim() || (needsPassword && !password)}>
            {loading ? "Проверка..." : "Войти"}
          </button>
          {needsPassword && (
            <button type="button" className="secondary-button" onClick={backToNickname}>
              Другой ник
            </button>
          )}
          <a className="secondary-button row-link-button" href="#/">На главную</a>
        </form>
      </section>
    </main>
  );
}

function HomeScreen({ session }: { session: Session | null }) {
  const [page, setPage] = useState<HomePage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.home()
      .then(setPage)
      .catch((error) => setError(error instanceof Error ? error.message : "Не удалось загрузить главную страницу"));
  }, []);

  return (
    <main className="shell document-page home-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">327 Star Corp</p>
          <h1>{page?.title || "327 Star Corp"}</h1>
        </div>
        <div className="top-actions">
          <a className="ghost-link primary-home-link" href="#/archive">{session ? "В архив" : "Войти в архив"}</a>
          {session?.is_admin && <a className="ghost-link" href="#/ghost-admin"><Shield size={16} /> Админка</a>}
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {!error && !page && <div className="empty">Загрузка главной...</div>}
      {page && (
        <article className="markdown-document full-document">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content || "_Главная страница пустая._"}</ReactMarkdown>
        </article>
      )}
    </main>
  );
}

function DiscordVerification({ session, onComplete, onRestart }: { session: Session; onComplete: (session: Session) => void; onRestart: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendWait, setResendWait] = useState(session.verification_resend_available_in ?? 0);
  const [sendsRemaining, setSendsRemaining] = useState(session.verification_sends_remaining ?? 0);

  useEffect(() => {
    setResendWait(session.verification_resend_available_in ?? 0);
    setSendsRemaining(session.verification_sends_remaining ?? 0);
  }, [session]);

  useEffect(() => {
    if (resendWait <= 0) return;
    const timer = window.setInterval(() => {
      setResendWait((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendWait]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const updated = await api.confirmVerificationCode(code);
      api.saveSession(updated);
      onComplete(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось подтвердить код");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError("");
    setLoading(true);
    try {
      const updated = await api.resendVerificationCode();
      api.saveSession(updated);
      setResendWait(updated.verification_resend_available_in ?? 60);
      setSendsRemaining(updated.verification_sends_remaining ?? 0);
      onComplete(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось отправить код повторно");
    } finally {
      setLoading(false);
    }
  }

  async function restart() {
    setError("");
    setLoading(true);
    try {
      await onRestart();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="login-panel">
        <p className="eyebrow">Discord verification</p>
        <h1>Код из Discord</h1>
        <div className={session.discord_delivery_failed ? "alert" : "notice"}>
          {session.discord_delivery_failed
            ? "Discord не доставил сообщение. Возьмите код у администратора — поле ввода уже доступно."
            : "Вам пришло сообщение с кодом в Discord."}
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            Никнейм
            <input name="username" autoComplete="username" value={session.profile.nickname} readOnly />
          </label>
          <label>
            Шестизначный код
            <input
              name="one-time-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
            />
          </label>
          {error && <div className="alert">{error}</div>}
          <button disabled={loading || code.length !== 6}>{loading ? "Проверка..." : "Подтвердить"}</button>
          <button type="button" className="secondary-button" disabled={loading || resendWait > 0 || sendsRemaining <= 0} onClick={resend}>
            {resendWait > 0 ? `Повторно через ${resendWait} сек.` : sendsRemaining > 0 ? `Отправить ещё раз (${sendsRemaining})` : "Лимит отправок исчерпан"}
          </button>
          <button type="button" className="secondary-button restart-button" disabled={loading} onClick={restart}>
            Выйти и начать регистрацию заново
          </button>
        </form>
      </section>
    </main>
  );
}

function PasswordSetup({ onComplete }: { session: Session; onComplete: (session: Session) => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      const updated = await api.setPassword(password);
      api.saveSession(updated);
      onComplete(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="login-panel">
        <p className="eyebrow">327 Star Corp</p>
        <h1>Новый пароль</h1>
        <form onSubmit={submit} className="login-form">
          <label>
            Пароль
            <input
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={4}
            />
          </label>
          <label>
            Повтор пароля
            <input
              name="confirm-password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              type="password"
              minLength={4}
            />
          </label>
          {error && <div className="alert">{error}</div>}
          <button disabled={loading || password.length < 4 || repeat.length < 4}>{loading ? "Сохранение..." : "Сохранить"}</button>
        </form>
      </section>
    </main>
  );
}

function ProfileCard({ profile }: { profile: Soldier }) {
  const { details, summary } = splitRawRows(profile);
  const hasExpandedInfo = details.length > 0 || summary.length > 0;
  return (
    <section className="profile-card">
      <div>
        <span className="rank">{profile.rank || "Боец"}</span>
        <h2>{profile.nickname}</h2>
      </div>
      <div className="profile-grid">
        {profileRows(profile).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {hasExpandedInfo && (
        <details>
          <summary>Расширенная информация</summary>
          {details.length > 0 && (
            <div className="raw-section">
              <h3>Данные бойца</h3>
              <div className="raw-grid">
                {details.map(([key, value]) => (
                  <p key={key}>
                    <span>{key}</span>
                    <b>{String(value || "-")}</b>
                  </p>
                ))}
              </div>
            </div>
          )}
          {summary.length > 0 && (
            <div className="raw-section">
              <h3>Сводка бойца</h3>
              <div className="raw-grid">
                {summary.map(([key, value]) => (
                  <p key={key}>
                    <span>{key}</span>
                    <b>{String(value || "-")}</b>
                  </p>
                ))}
              </div>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

function ProfilesView({ soldiers }: { soldiers: Soldier[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Soldier | null>(soldiers[0] ?? null);
  const filtered = soldiers.filter((soldier) => soldier.nickname.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!selected && soldiers[0]) setSelected(soldiers[0]);
  }, [selected, soldiers]);

  return (
    <div className="split">
      <aside className="list-panel">
        <label className="search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по нику" />
        </label>
        <div className="roster">
          {filtered.map((soldier) => (
            <button key={soldier.id} className={selected?.id === soldier.id ? "active" : ""} onClick={() => setSelected(soldier)}>
              <span>{soldier.nickname}</span>
              <small>{soldier.rank || soldier.number || "Профиль"}</small>
            </button>
          ))}
        </div>
      </aside>
      {selected ? <ProfileCard profile={selected} /> : <div className="empty">Профиль не выбран</div>}
    </div>
  );
}

function FormsView({ tabs }: { tabs: FormTab[] }) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "");
  const [openForm, setOpenForm] = useState<{ title: string; url: string } | null>(null);
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!activeTab && tabs[0]) setActiveTab(tabs[0].id);
  }, [activeTab, tabs]);

  if (!current) return <div className="empty">Формы пока не добавлены</div>;

  function embedUrl(url: string) {
    try {
      const next = new URL(url);
      if (next.hostname === "docs.google.com" && next.pathname.includes("/forms/")) {
        next.searchParams.set("embedded", "true");
      }
      return next.toString();
    } catch {
      return url;
    }
  }

  return (
    <section>
      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab.id} className={current.id === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.title}
          </button>
        ))}
      </div>
      <div className="forms-grid">
        {current.forms.length === 0 && <div className="empty">В этой вкладке пока пусто</div>}
        {current.forms.map((form) => (
          <article className="form-card" key={form.id}>
            <div>
              <span>{audienceLabel(form.audience)}</span>
              <h3>{form.title}</h3>
              {form.description && <p>{form.description}</p>}
            </div>
            <div className="form-actions">
              <button onClick={() => setOpenForm({ title: form.title, url: form.url })}>Открыть</button>
              <a className="compact-link" href={form.url} target="_blank" rel="noreferrer">
                Перейти <ExternalLink size={14} />
              </a>
            </div>
          </article>
        ))}
      </div>
      {openForm && (
        <div className="form-modal" role="dialog" aria-modal="true" aria-label={openForm.title}>
          <div className="form-modal-bar">
            <h2>{openForm.title}</h2>
            <button className="icon-button" onClick={() => setOpenForm(null)} title="Закрыть">
              <X size={20} />
            </button>
          </div>
          <iframe
            src={embedUrl(openForm.url)}
            title={openForm.title}
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          >
            Загрузка...
          </iframe>
        </div>
      )}
    </section>
  );
}

function DocsView({ sections }: { sections: DocsSection[] }) {
  const [activeSection, setActiveSection] = useState("all");
  const [query, setQuery] = useState("");
  const virtualSections: DocsSection[] = useMemo(() => {
    const allDocs = sections.flatMap((section) => section.docs);
    return [
      { id: "all", title: "Все", audience: "public", docs: allDocs },
      ...sections,
    ];
  }, [sections]);
  const currentSection = virtualSections.find((section) => section.id === activeSection) ?? virtualSections[0];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDocs = currentSection.docs.filter((doc) => {
    if (!normalizedQuery) return true;
    return [doc.title, doc.description, doc.content].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  useEffect(() => {
    if (!virtualSections.some((section) => section.id === activeSection)) {
      setActiveSection("all");
    }
  }, [activeSection, virtualSections]);

  if (!currentSection) return <div className="empty">Документация пока не добавлена</div>;

  return (
    <section className="docs-catalog">
      <aside className="docs-sidebar">
        <div className="tabs docs-section-tabs">
          {virtualSections.map((section) => (
            <button key={section.id} className={currentSection.id === section.id ? "active" : ""} onClick={() => setActiveSection(section.id)}>
              {section.title}
            </button>
          ))}
        </div>
        <label className="search docs-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск документа" />
        </label>
        <div className="docs-list">
          {filteredDocs.length === 0 && <div className="empty">{query ? "Документы не найдены" : "В разделе пока нет документов"}</div>}
          {filteredDocs.map((doc) => (
            <a key={doc.id} className="doc-link-card" href={`#/docs/${doc.id}`}>
              <strong>{doc.title}</strong>
              {doc.description && <small>{doc.description}</small>}
            </a>
          ))}
        </div>
      </aside>
    </section>
  );
}

function DocPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDoc(null);
    setError("");
    api.doc(docId)
      .then(setDoc)
      .catch((error) => setError(error instanceof Error ? error.message : "Документ не найден"));
  }, [docId]);

  return (
    <main className="shell document-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Документация</p>
          <h1>{doc?.title || "Документ"}</h1>
        </div>
        <div className="top-actions">
          <a className="ghost-link" href="#/">Главная</a>
          <a className="ghost-link" href="#/archive">В портал</a>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {!error && !doc && <div className="empty">Загрузка документа...</div>}
      {doc && (
        <div className="document-reading-layout">
          <article className="markdown-document full-document">
            <div className="document-header">
              <span>{audienceLabel(doc.audience)}</span>
              <h2>{doc.title}</h2>
              {doc.description && <p>{doc.description}</p>}
            </div>
            <MarkdownWithOutline content={doc.content} />
          </article>
          <DocumentOutline content={doc.content} />
        </div>
      )}
    </main>
  );
}

function DocumentOutline({ content }: { content: string }) {
  const outline = useMemo(() => extractDocumentOutline(content), [content]);
  if (!outline.length) return null;
  return (
    <aside className="document-outline" aria-label="Содержание документа">
      <strong>На этой странице</strong>
      <nav>
        {outline.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.level === 1 ? "outline-section" : "outline-subsection"}
            title={item.text}
            style={{ "--heading-level": item.level } as React.CSSProperties}
            onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {item.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function DocEditPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [docsStore, setDocsStore] = useState<DocsSection[]>([]);
  const [docAccessRules, setDocAccessRules] = useState<AccessRules>(emptyAccessRules);
  const [docDraft, setDocDraft] = useState<Omit<DocItem, "id">>(emptyDocDraft());
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError("");
    Promise.all([api.doc(docId), api.adminDocsStore(), api.docAccessRules()])
      .then(([doc, store, rules]) => {
        setDoc(doc);
        setDocsStore(store.sections);
        setDocAccessRules(rules);
        setDocDraft({
          title: doc.title,
          section_id: doc.section_id,
          audience: doc.audience,
          content: doc.content,
          description: doc.description,
          active: doc.active,
        });
      })
      .catch((error) => setError(error instanceof Error ? error.message : "Документ не найден"));
  }, [docId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const updated = await api.updateDoc(docId, docDraft);
      setDoc(updated);
      setSavedMessage("Сохранено");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить документ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell document-page edit-document-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Редактирование документации</p>
          <h1>{doc?.title || "Документ"}</h1>
        </div>
        <div className="top-actions">
          <a className="ghost-link" href="#/">Главная</a>
          <a className="ghost-link" href={`#/docs/${docId}`}>К документу</a>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {!doc && !error && <div className="empty">Загрузка редактора...</div>}
      {doc && (
        <form className="admin-form docs-editor-form page-editor" onSubmit={submit}>
          <section className="editor-split">
            <div className="editor-pane">
              <DocEditorFields docDraft={docDraft} setDocDraft={setDocDraft} docsStore={docsStore} accessGroups={docAccessRules.groups} />
              <div className="form-actions">
                <button disabled={saving || !docDraft.title.trim() || !docDraft.section_id}>{saving ? "Сохранение..." : "Сохранить"}</button>
                <a className="secondary-button row-link-button" href={`#/docs/${docId}`}>К документу</a>
                {savedMessage && <small>{savedMessage}</small>}
              </div>
            </div>
            <article className="markdown-document editor-preview">
              <div className="document-header">
                <span>{audienceLabel(docDraft.audience, docAccessRules.groups)}</span>
                <h2>{docDraft.title || "Без названия"}</h2>
                {docDraft.description && <p>{docDraft.description}</p>}
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{docDraft.content || "_Документ пустой._"}</ReactMarkdown>
            </article>
          </section>
        </form>
      )}
    </main>
  );
}

function MarkdownEditorTextarea({
  value,
  setValue,
}: {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function restoreEditorPosition(cursorPosition: number, scrollTop: number) {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(cursorPosition, cursorPosition);
      textarea.scrollTop = scrollTop;
    });
  }

  function insertText(text: string, start: number, end: number, scrollTop: number) {
    setValue((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    restoreEditorPosition(start + text.length, scrollTop);
  }

  function replaceText(search: string, replacement: string, scrollTop: number) {
    let cursorPosition = 0;
    setValue((current) => {
      const index = current.indexOf(search);
      if (index < 0) {
        cursorPosition = current.length;
        return current;
      }
      cursorPosition = index + replacement.length;
      return `${current.slice(0, index)}${replacement}${current.slice(index + search.length)}`;
    });
    restoreEditorPosition(cursorPosition, scrollTop);
  }

  async function uploadMarkdownImage(file: File, start: number, end: number) {
    const alt = ((file.name || "image").replace(/\.[^.]+$/, "") || "image").replace(/[[\]()]/g, " ");
    const placeholder = `![${alt}](загрузка...)`;
    const scrollTop = textareaRef.current?.scrollTop ?? 0;
    insertText(placeholder, start, end, scrollTop);
    try {
      const result = await api.uploadImage(file);
      replaceText(placeholder, `![${alt}](${result.url})`, scrollTop);
    } catch {
      replaceText(placeholder, `<!-- Не удалось загрузить изображение: ${alt} -->`, scrollTop);
    }
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    if (!file) return;

    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    void uploadMarkdownImage(file, start, end);
  }

  return (
    <textarea
      ref={textareaRef}
      className="markdown-editor"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPaste={pasteImage}
      placeholder={"# Заголовок\n\nТекст документа.\n\n| Колонка | Значение |\n| --- | --- |\n| Пример | Данные |\n\n![Описание](https://...)"}
    />
  );
}

function AccessGroupModal({
  group,
  onClose,
  onSave,
}: {
  group: AccessGroup | null;
  onClose: () => void;
  onSave: (payload: AccessGroupPayload, id?: string) => Promise<void>;
}) {
  const [id, setId] = useState(group?.id ?? "");
  const [title, setTitle] = useState(group?.title ?? "");
  const [ranks, setRanks] = useState(formatList(group?.ranks ?? []));
  const [specializations, setSpecializations] = useState(formatList(group?.specializations ?? []));
  const [positions, setPositions] = useState(formatList(group?.positions ?? []));
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(group);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(
        {
          id: isEdit ? undefined : id.trim() || undefined,
          title,
          ranks: parseList(ranks),
          specializations: parseList(specializations),
          positions: parseList(positions),
        },
        group?.id,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Настройка доступа">
      <form className="access-modal" onSubmit={submit}>
        <div className="form-modal-bar">
          <h2>{isEdit ? "Настройка доступа" : "Новый доступ"}</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="access-modal-body">
          <label>
            Название доступа
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Инструкторы" autoFocus />
          </label>
          {!isEdit && (
            <label>
              Ключ доступа
              <input value={id} onChange={(event) => setId(event.target.value)} placeholder="instructor или officers" />
            </label>
          )}
          <label>
            Звания, которые входят в доступ
            <textarea value={ranks} onChange={(event) => setRanks(event.target.value)} placeholder={"CPT\nSPL\nSLT"} />
          </label>
          <label>
            Специализации, которые входят в доступ
            <textarea value={specializations} onChange={(event) => setSpecializations(event.target.value)} placeholder={"HMS\nAAT\nARF"} />
          </label>
          <label>
            Фрагменты должностей, которые входят в доступ
            <textarea value={positions} onChange={(event) => setPositions(event.target.value)} placeholder={"INS\nMedic\nКомандир"} />
          </label>
          <div className="access-actions">
            <button disabled={saving || !title.trim()}>{saving ? "Сохранение..." : "Сохранить"}</button>
            <button type="button" className="secondary-button" onClick={onClose}>Отмена</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function HomeEditPage() {
  const [homePage, setHomePage] = useState<HomePage>({ title: "327 Star Corp", content: "" });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError("");
    api.home()
      .then((page) => {
        setHomePage(page);
        setLoaded(true);
      })
      .catch((error) => setError(error instanceof Error ? error.message : "Не удалось загрузить главную страницу"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const updated = await api.updateHome(homePage);
      setHomePage(updated);
      setSavedMessage("Сохранено");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить главную страницу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell document-page edit-document-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Редактирование главной</p>
          <h1>{homePage.title || "Главная страница"}</h1>
        </div>
        <a className="ghost-link" href="#/">К главной</a>
      </header>
      {error && <div className="alert">{error}</div>}
      {!loaded && !error && <div className="empty">Загрузка редактора...</div>}
      {loaded && (
        <form className="admin-form docs-editor-form page-editor" onSubmit={submit}>
          <section className="editor-split">
            <div className="editor-pane">
              <input value={homePage.title} onChange={(event) => setHomePage({ ...homePage, title: event.target.value })} placeholder="Заголовок главной" />
              <MarkdownEditorTextarea
                value={homePage.content}
                setValue={(next) =>
                  setHomePage((current) => ({
                    ...current,
                    content: typeof next === "function" ? next(current.content) : next,
                  }))
                }
              />
              <div className="form-actions">
                <button disabled={saving || !homePage.title.trim()}>{saving ? "Сохранение..." : "Сохранить"}</button>
                <a className="secondary-button row-link-button" href="#/">К главной</a>
                {savedMessage && <small>{savedMessage}</small>}
              </div>
            </div>
            <article className="markdown-document editor-preview">
              <div className="document-header">
                <span>Главная</span>
                <h2>{homePage.title || "Без названия"}</h2>
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{homePage.content || "_Главная страница пустая._"}</ReactMarkdown>
            </article>
          </section>
        </form>
      )}
    </main>
  );
}

function DocEditorFields({
  docDraft,
  setDocDraft,
  docsStore,
  accessGroups,
}: {
  docDraft: Omit<DocItem, "id">;
  setDocDraft: Dispatch<SetStateAction<Omit<DocItem, "id">>>;
  docsStore: DocsSection[];
  accessGroups: AccessGroup[];
}) {
  return (
    <>
      <input value={docDraft.title} onChange={(event) => setDocDraft({ ...docDraft, title: event.target.value })} placeholder="Название документа" />
      <input value={docDraft.description} onChange={(event) => setDocDraft({ ...docDraft, description: event.target.value })} placeholder="Короткое описание" />
      <div className="docs-editor-row">
        <select value={docDraft.section_id} onChange={(event) => setDocDraft({ ...docDraft, section_id: event.target.value })}>
          {docsStore.map((section) => (
            <option key={section.id} value={section.id}>{section.title}</option>
          ))}
        </select>
        <select value={docDraft.audience} onChange={(event) => setDocDraft({ ...docDraft, audience: event.target.value })}>
          <option value="public">Для всех</option>
          {accessGroups.map((group) => (
            <option key={group.id} value={group.id}>{group.title}</option>
          ))}
          <option value="admin">Админы</option>
        </select>
      </div>
      <MarkdownEditorTextarea
        value={docDraft.content}
        setValue={(next) =>
          setDocDraft((current) => ({
            ...current,
            content: typeof next === "function" ? next(current.content) : next,
          }))
        }
      />
    </>
  );
}

function AdminPanel({ session }: { session: Session }) {
  const [store, setStore] = useState<FormTab[]>([]);
  const [docsStore, setDocsStore] = useState<DocsSection[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [verificationCodes, setVerificationCodes] = useState<VerificationCodeAdminItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [accessRules, setAccessRules] = useState<AccessRules>(emptyAccessRules);
  const [docAccessRules, setDocAccessRules] = useState<AccessRules>(emptyAccessRules);
  const [editingAccessGroup, setEditingAccessGroup] = useState<AccessGroup | null | undefined>(undefined);
  const [editingDocAccessGroup, setEditingDocAccessGroup] = useState<AccessGroup | null | undefined>(undefined);
  const [tabTitle, setTabTitle] = useState("");
  const [tabAudience, setTabAudience] = useState<Audience>("public");
  const [form, setForm] = useState({ title: "", url: "", description: "", tab_id: "", audience: "public" as Audience, active: true });
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [formsAdminSheet, setFormsAdminSheet] = useState<FormsAdminSheet>("view");
  const [docsSectionTitle, setDocsSectionTitle] = useState("");
  const [docsSectionAudience, setDocsSectionAudience] = useState<Audience>("public");
  const [docDraft, setDocDraft] = useState<Omit<DocItem, "id">>({
    title: "",
    section_id: "",
    audience: "public",
    content: "",
    description: "",
    active: true,
  });
  const [docsAdminSheet, setDocsAdminSheet] = useState<DocsAdminSheet>("view");
  const [error, setError] = useState("");

  async function refresh() {
    const [result, docsResult, accounts, codes, audit, rules, docRules] = await Promise.all([
      api.adminStore(),
      api.adminDocsStore(),
      api.adminUsers(),
      api.adminVerificationCodes(),
      api.adminAudit(),
      api.accessRules(),
      api.docAccessRules(),
    ]);
    setStore(result.tabs);
    setDocsStore(docsResult.sections);
    setUsers(accounts);
    setVerificationCodes(codes);
    setAuditEvents(audit);
    setAccessRules(rules);
    setDocAccessRules(docRules);
    setForm((current) => ({ ...current, tab_id: current.tab_id || result.tabs[0]?.id || "" }));
    setDocDraft((current) => ({ ...current, section_id: current.section_id || docsResult.sections[0]?.id || "" }));
  }

  useEffect(() => {
    refresh().catch((error) => setError(error instanceof Error ? error.message : "Ошибка загрузки"));
  }, []);

  async function addTab(event: FormEvent) {
    event.preventDefault();
    await api.createTab(tabTitle, tabAudience);
    setTabTitle("");
    await refresh();
  }

  async function saveForm(event: FormEvent) {
    event.preventDefault();
    if (editingFormId) {
      await api.updateForm(editingFormId, form);
    } else {
      await api.createForm(form);
    }
    setEditingFormId(null);
    setFormsAdminSheet("view");
    setForm({ title: "", url: "", description: "", tab_id: form.tab_id, audience: form.audience, active: true });
    await refresh();
  }

  async function removeForm(id: string) {
    await api.deleteForm(id);
    await refresh();
  }

  async function moveForm(id: string, direction: "up" | "down") {
    await api.moveForm(id, direction);
    await refresh();
  }

  function editForm(item: FormItem) {
    setForm({
      title: item.title,
      url: item.url,
      description: item.description,
      tab_id: item.tab_id,
      audience: item.audience,
      active: item.active,
    });
    setEditingFormId(item.id);
    setFormsAdminSheet("edit");
  }

  async function removeTab(id: string) {
    await api.deleteTab(id);
    setForm((current) => ({ ...current, tab_id: current.tab_id === id ? "" : current.tab_id }));
    await refresh();
  }

  async function moveTab(id: string, direction: "up" | "down") {
    await api.moveTab(id, direction);
    await refresh();
  }

  async function addDocsSection(event: FormEvent) {
    event.preventDefault();
    await api.createDocsSection(docsSectionTitle, docsSectionAudience);
    setDocsSectionTitle("");
    await refresh();
  }

  async function removeDocsSection(id: string) {
    await api.deleteDocsSection(id);
    setDocDraft((current) => ({ ...current, section_id: current.section_id === id ? "" : current.section_id }));
    await refresh();
  }

  async function moveDocsSection(id: string, direction: "up" | "down") {
    await api.moveDocsSection(id, direction);
    await refresh();
  }

  async function saveDoc(event: FormEvent) {
    event.preventDefault();
    await api.createDoc(docDraft);
    setDocsAdminSheet("view");
    setDocDraft(emptyDocDraft(docDraft.section_id));
    await refresh();
  }

  async function removeDoc(id: string) {
    await api.deleteDoc(id);
    await refresh();
  }

  async function moveDoc(id: string, direction: "up" | "down") {
    await api.moveDoc(id, direction);
    await refresh();
  }

  async function resetPassword(nickname: string) {
    await api.resetUserPassword(nickname);
    await refresh();
  }

  async function cancelVerification(nickname: string) {
    if (!window.confirm(`Отменить код и удалить все попытки верификации для ${nickname}?`)) return;
    await api.deleteVerificationCodes(nickname);
    await refresh();
  }

  async function updateRoles(user: UserAccount, next: Partial<Pick<UserAccount, "is_admin">>) {
    const isAdmin = next.is_admin ?? user.is_admin;
    const updated = await api.updateUserRoles(user.nickname, user.is_default_admin ? false : isAdmin);
    setUsers((current) => current.map((item) => (item.nickname === updated.nickname ? updated : item)));
  }

  async function saveAccessGroup(payload: AccessGroupPayload, id?: string) {
    if (id) {
      await api.updateAccessGroup(id, payload);
    } else {
      await api.createAccessGroup(payload);
    }
    await refresh();
  }

  async function removeAccessGroup(id: string) {
    await api.deleteAccessGroup(id);
    await refresh();
  }

  async function saveDocAccessGroup(payload: AccessGroupPayload, id?: string) {
    if (id) {
      await api.updateDocAccessGroup(id, payload);
    } else {
      await api.createDocAccessGroup(payload);
    }
    await refresh();
  }

  async function removeDocAccessGroup(id: string) {
    await api.deleteDocAccessGroup(id);
    await refresh();
  }

  if (!session.is_admin) {
    return <LoginScreen onLogin={() => window.location.reload()} />;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ghost Admin</p>
          <h1>Админка</h1>
        </div>
        <div className="top-actions">
          <a className="ghost-link" href="#/">Главная</a>
          <a className="ghost-link" href="#/archive">В портал</a>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      <section className="admin-section">
        <div className="section-heading-row">
          <div>
            <h2>Главная страница</h2>
            <p>Markdown-документ, который видят на `/` до входа в архив.</p>
          </div>
          <div className="row-actions">
            <a className="secondary-button row-link-button" href="#/">Открыть</a>
            <a className="secondary-button row-link-button" href="#/home/edit">Редактировать</a>
          </div>
        </div>
      </section>
      <section className="admin-section">
        <h2>Формы</h2>
        <div className="nested-admin-block">
          <h3>Доступы форм</h3>
          <div className="section-heading-row">
            <p>Эти права используются только для вкладок и Google Forms.</p>
            <button onClick={() => setEditingAccessGroup(null)}>Создать доступ</button>
          </div>
          <div className="access-groups-list">
            {accessRules.groups.length === 0 && <div className="empty">Группы доступа пока не созданы</div>}
            {accessRules.groups.map((group) => (
              <article className="access-group-card" key={group.id}>
                <div>
                  <span>{group.id}</span>
                  <h3>{group.title}</h3>
                  <p>
                    Звания: {group.ranks.length ? group.ranks.join(", ") : "не указаны"}
                  </p>
                  <p>
                    Специализации: {group.specializations.length ? group.specializations.join(", ") : "не указаны"}
                  </p>
                  <p>
                    Должности: {(group.positions ?? []).length ? group.positions.join(", ") : "не указаны"}
                  </p>
                </div>
                <div className="access-card-actions">
                  <button onClick={() => setEditingAccessGroup(group)}>Настроить</button>
                  <button className="danger-button" onClick={() => removeAccessGroup(group.id)}>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="tabs admin-docs-tabs">
          <button className={formsAdminSheet === "view" ? "active" : ""} onClick={() => setFormsAdminSheet("view")}>Просмотр</button>
          <button className={formsAdminSheet === "create" ? "active" : ""} onClick={() => { setEditingFormId(null); setFormsAdminSheet("create"); }}>Создание</button>
        </div>
        {formsAdminSheet === "view" && (
          <div className="admin-docs-sheet">
            <form className="admin-form inline-admin-form" onSubmit={addTab}>
              <input value={tabTitle} onChange={(event) => setTabTitle(event.target.value)} placeholder="Название раздела форм" />
              <select value={tabAudience} onChange={(event) => setTabAudience(event.target.value as Audience)}>
                <option value="public">Для всех</option>
                {accessRules.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.title}</option>
                ))}
                <option value="admin">Админы</option>
              </select>
              <button>Добавить раздел</button>
            </form>
            <div className="admin-docs-viewer single-column">
              <div className="admin-list docs-admin-list">
                {store.map((tab) => (
                  <div key={tab.id}>
                    <h3>{tab.title} <small>{audienceLabel(tab.audience, accessRules.groups)}</small></h3>
                    <div className="admin-form-row">
                      <span>Раздел форм</span>
                      <div className="row-actions">
                        <button className="secondary-button" onClick={() => moveTab(tab.id, "up")} title="Выше">↑</button>
                        <button className="secondary-button" onClick={() => moveTab(tab.id, "down")} title="Ниже">↓</button>
                        <button onClick={() => removeTab(tab.id)}>Удалить раздел</button>
                      </div>
                    </div>
                    {tab.forms.length === 0 && <p className="admin-empty-row">Форм пока нет</p>}
                    {tab.forms.map((item) => (
                      <div className="admin-form-row" key={item.id}>
                        <span>{item.title} <small>{audienceLabel(item.audience, accessRules.groups)}</small></span>
                        <div className="row-actions">
                          <button className="secondary-button" onClick={() => moveForm(item.id, "up")} title="Выше">↑</button>
                          <button className="secondary-button" onClick={() => moveForm(item.id, "down")} title="Ниже">↓</button>
                          <button className="secondary-button" onClick={() => editForm(item)}>Редактировать</button>
                          <button onClick={() => removeForm(item.id)}>Удалить форму</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {formsAdminSheet !== "view" && (
          <form className="admin-form docs-editor-form" onSubmit={saveForm}>
            <h3>{formsAdminSheet === "edit" ? "Редактирование формы" : "Новая форма"}</h3>
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Название формы" />
            <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://forms.gle/..." />
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Короткое описание" />
            <select value={form.tab_id} onChange={(event) => setForm({ ...form, tab_id: event.target.value })}>
              {store.map((tab) => (
                <option key={tab.id} value={tab.id}>{tab.title}</option>
              ))}
            </select>
            <select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as Audience })}>
              <option value="public">Для всех</option>
              {accessRules.groups.map((group) => (
                <option key={group.id} value={group.id}>{group.title}</option>
              ))}
              <option value="admin">Админы</option>
            </select>
            <label className="check-control">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
              Форма активна
            </label>
            <button>{formsAdminSheet === "edit" ? "Сохранить изменения" : "Добавить форму"}</button>
          </form>
        )}
      </section>
      <section className="admin-section">
        <h2>Документация</h2>
        <div className="nested-admin-block">
          <h3>Доступы документации</h3>
          <div className="section-heading-row">
            <p>Эти права используются только для разделов и Markdown-документов.</p>
            <button onClick={() => setEditingDocAccessGroup(null)}>Создать доступ</button>
          </div>
          <div className="access-groups-list">
            {docAccessRules.groups.length === 0 && <div className="empty">Группы доступа документации пока не созданы</div>}
            {docAccessRules.groups.map((group) => (
              <article className="access-group-card" key={group.id}>
                <div>
                  <span>{group.id}</span>
                  <h3>{group.title}</h3>
                  <p>Звания: {group.ranks.length ? group.ranks.join(", ") : "не указаны"}</p>
                  <p>Специализации: {group.specializations.length ? group.specializations.join(", ") : "не указаны"}</p>
                  <p>Должности: {(group.positions ?? []).length ? group.positions.join(", ") : "не указаны"}</p>
                </div>
                <div className="access-card-actions">
                  <button onClick={() => setEditingDocAccessGroup(group)}>Настроить</button>
                  <button className="danger-button" onClick={() => removeDocAccessGroup(group.id)}>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="tabs admin-docs-tabs">
          <button className={docsAdminSheet === "view" ? "active" : ""} onClick={() => setDocsAdminSheet("view")}>Просмотр</button>
          <button
            className={docsAdminSheet === "create" ? "active" : ""}
            onClick={() => {
              setDocDraft(emptyDocDraft(docsStore[0]?.id || ""));
              setDocsAdminSheet("create");
            }}
          >
            Создание
          </button>
        </div>
        {docsAdminSheet === "view" && (
          <div className="admin-docs-sheet">
            <form className="admin-form inline-admin-form" onSubmit={addDocsSection}>
              <input value={docsSectionTitle} onChange={(event) => setDocsSectionTitle(event.target.value)} placeholder="Название раздела" />
              <select value={docsSectionAudience} onChange={(event) => setDocsSectionAudience(event.target.value)}>
                <option value="public">Для всех</option>
                {docAccessRules.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.title}</option>
                ))}
                <option value="admin">Админы</option>
              </select>
              <button>Добавить раздел</button>
            </form>
            <div className="admin-docs-viewer single-column">
              <div className="admin-list docs-admin-list">
                {docsStore.map((section) => (
                  <div key={section.id}>
                    <h3>{section.title} <small>{audienceLabel(section.audience, docAccessRules.groups)}</small></h3>
                    <div className="admin-form-row">
                      <span>Раздел документации</span>
                      <div className="row-actions">
                        <button className="secondary-button" onClick={() => moveDocsSection(section.id, "up")} title="Выше">↑</button>
                        <button className="secondary-button" onClick={() => moveDocsSection(section.id, "down")} title="Ниже">↓</button>
                        <button onClick={() => removeDocsSection(section.id)}>Удалить раздел</button>
                      </div>
                    </div>
                    {section.docs.length === 0 && <p className="admin-empty-row">Документов пока нет</p>}
                    {section.docs.map((doc) => (
                      <div className="admin-form-row" key={doc.id}>
                        <span>{doc.title} <small>{audienceLabel(doc.audience, docAccessRules.groups)}</small></span>
                        <div className="row-actions">
                          <button className="secondary-button" onClick={() => moveDoc(doc.id, "up")} title="Выше">↑</button>
                          <button className="secondary-button" onClick={() => moveDoc(doc.id, "down")} title="Ниже">↓</button>
                          <a className="secondary-button row-link-button" href={`#/docs/${doc.id}`}>Открыть</a>
                          <a className="secondary-button row-link-button" href={`#/docs/${doc.id}/edit`}>Редактировать</a>
                          <button onClick={() => removeDoc(doc.id)}>Удалить</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {docsAdminSheet === "create" && (
          <form className="admin-form docs-editor-form" onSubmit={saveDoc}>
            <h3>Новый документ</h3>
            <DocEditorFields docDraft={docDraft} setDocDraft={setDocDraft} docsStore={docsStore} accessGroups={docAccessRules.groups} />
            <button disabled={!docDraft.title.trim() || !docDraft.section_id}>Добавить документ</button>
          </form>
        )}
      </section>
      {editingAccessGroup !== undefined && (
        <AccessGroupModal
          group={editingAccessGroup}
          onClose={() => setEditingAccessGroup(undefined)}
          onSave={saveAccessGroup}
        />
      )}
      {editingDocAccessGroup !== undefined && (
        <AccessGroupModal
          group={editingDocAccessGroup}
          onClose={() => setEditingDocAccessGroup(undefined)}
          onSave={saveDocAccessGroup}
        />
      )}
      {isAuditOpen && <AuditModal events={auditEvents} onClose={() => setIsAuditOpen(false)} />}
      <section className="admin-section">
        <div className="section-heading-row">
          <div>
            <h2>Коды подтверждения</h2>
            <p>Аварийный список активных кодов, если Discord не доставляет личные сообщения.</p>
          </div>
          <button className="secondary-button" onClick={() => refresh().catch((error) => setError(error instanceof Error ? error.message : "Ошибка загрузки"))}>
            Обновить
          </button>
        </div>
        <div className="admin-list accounts-list">
          {verificationCodes.length === 0 && <div className="empty">Активных кодов нет</div>}
          {verificationCodes.map((item) => (
            <div className="account-row verification-code-row" key={`${item.nickname}-${item.discord_id}`}>
              <div>
                <strong>{item.nickname}</strong>
                <small>
                  Discord ID: {item.discord_id} · отправок: {item.send_count} · ошибок ввода: {item.attempt_count}
                </small>
                <small>
                  {item.locked_until
                    ? `Попытки заблокированы до ${new Date(item.locked_until).toLocaleString()}`
                    : `Истекает ${new Date(item.expires_at).toLocaleString()}`}
                </small>
              </div>
              <div className="row-actions">
                <strong className="verification-code">{item.code}</strong>
                <button className="danger-button" onClick={() => cancelVerification(item.nickname)}>Отменить</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="admin-section">
        <div className="section-heading-row">
          <div>
            <h2>Журнал админки</h2>
            <p>История действий открывается в отдельном окне.</p>
          </div>
          <div className="row-actions">
            <button className="secondary-button" onClick={() => refresh().catch((error) => setError(error instanceof Error ? error.message : "Ошибка загрузки"))}>Обновить</button>
            <button onClick={() => setIsAuditOpen(true)}>Открыть журнал</button>
          </div>
        </div>
      </section>
      <section className="admin-section">
        <h2>Учётки</h2>
        <div className="admin-list accounts-list">
          {users.map((user) => (
            <div className="account-row" key={user.nickname}>
              <div>
                <strong>{user.nickname}</strong>
                <small>{user.has_password ? "пароль задан" : "без пароля"}{user.is_default_admin ? " · админ по умолчанию" : ""}</small>
              </div>
              <label className="check-control">
                <input
                  type="checkbox"
                  checked={user.is_admin}
                  disabled={user.is_default_admin}
                  onChange={(event) => updateRoles(user, { is_admin: event.target.checked })}
                />
                Админ
              </label>
              <button disabled={!user.has_password} onClick={() => resetPassword(user.nickname)}>Сбросить пароль</button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function AuditModal({ events, onClose }: { events: AuditEventItem[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="access-modal audit-modal" role="dialog" aria-modal="true" aria-label="Журнал админки" onMouseDown={(event) => event.stopPropagation()}>
        <div className="form-modal-bar">
          <h2>Журнал админки</h2>
          <button className="secondary-button" onClick={onClose} aria-label="Закрыть журнал"><X size={18} /></button>
        </div>
        <div className="access-modal-body">
          {events.length === 0 && <div className="empty">Событий пока нет</div>}
          <div className="admin-list accounts-list">
            {events.map((event) => (
              <div className="account-row audit-row" key={event.id}>
                <div>
                  <strong>{event.action}</strong>
                  <small>{event.actor} · {new Date(event.created_at).toLocaleString()}</small>
                  {event.target && <small>Цель: {event.target}</small>}
                </div>
                <code>{JSON.stringify(event.details)}</code>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [session, setSession] = useState<Session | null>(storageSession);
  const [view, setView] = useState<View>("me");
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [forms, setForms] = useState<FormTab[]>([]);
  const [docs, setDocs] = useState<DocsSection[]>([]);
  const isAdminRoute = route === "#/ghost-admin";
  const isArchiveRoute = route === "#/archive";
  const isHomeEditRoute = route === "#/home/edit";
  const docEditRouteMatch = route.match(/^#\/docs\/([^/]+)\/edit$/);
  const docRouteMatch = route.match(/^#\/docs\/([^/]+)$/);
  const docEditRouteId = docEditRouteMatch ? decodeURIComponent(docEditRouteMatch[1]) : "";
  const docRouteId = docRouteMatch ? decodeURIComponent(docRouteMatch[1]) : "";
  const isAdminOnlyRoute = isAdminRoute || isHomeEditRoute || Boolean(docEditRouteId);

  useEffect(() => {
    const listener = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => setSession((event as CustomEvent<Session | null>).detail);
    window.addEventListener("star327-session", listener);
    return () => window.removeEventListener("star327-session", listener);
  }, []);

  useEffect(() => {
    if (isAdminOnlyRoute && (!session || !session.is_admin)) {
      window.location.hash = "#/";
    }
  }, [isAdminOnlyRoute, session]);

  useEffect(() => {
    if (!session || !isArchiveRoute || isAdminRoute || isHomeEditRoute || docRouteId || docEditRouteId) return;
    Promise.all([api.soldiers(), api.forms(), api.docs()]).then(([soldiers, forms, docs]) => {
      setSoldiers(soldiers);
      setForms(forms);
      setDocs(docs);
    });
  }, [session, isArchiveRoute, isAdminRoute, isHomeEditRoute, docRouteId, docEditRouteId]);

  const currentProfile = useMemo(() => session?.profile ?? null, [session]);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setSession(null);
    }
  }

  if (session?.requires_discord_verification) {
    return <DiscordVerification session={session} onComplete={setSession} onRestart={logout} />;
  }

  if (session?.requires_password_setup) {
    return <PasswordSetup session={session} onComplete={setSession} />;
  }

  if (isAdminRoute) {
    if (!session || !session.is_admin) return null;
    return <AdminPanel session={session} />;
  }

  if (isHomeEditRoute) {
    if (!session || !session.is_admin) {
      return null;
    }
    return <HomeEditPage />;
  }

  if (!isArchiveRoute && !docRouteId && !docEditRouteId) {
    return <HomeScreen session={session} />;
  }

  if (!session || !currentProfile) {
    return <LoginScreen onLogin={setSession} />;
  }

  if (docEditRouteId) {
    if (!session.is_admin) {
      return null;
    }
    return <DocEditPage docId={docEditRouteId} />;
  }

  if (docRouteId) {
    return <DocPage docId={docRouteId} />;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">327 Star Corp</p>
          <h1>Батальонный архив</h1>
        </div>
        <div className="top-actions">
          <a className="ghost-link" href="#/">Главная</a>
          {session.is_admin && <a className="ghost-link" href="#/ghost-admin"><Shield size={16} /> Админка</a>}
          <button className="icon-button" onClick={logout} title="Выйти"><LogOut size={18} /></button>
        </div>
      </header>
      <nav className="nav">
        <button className={view === "me" ? "active" : ""} onClick={() => setView("me")}><UserRound size={18} /> Мой профиль</button>
        <button className={view === "profiles" ? "active" : ""} onClick={() => setView("profiles")}><UsersRound size={18} /> Профили</button>
        <button className={view === "forms" ? "active" : ""} onClick={() => setView("forms")}><ClipboardList size={18} /> Формы</button>
        <button className={view === "docs" ? "active" : ""} onClick={() => setView("docs")}><BookOpenText size={18} /> Документация</button>
      </nav>
      {view === "me" && <ProfileCard profile={currentProfile} />}
      {view === "profiles" && <ProfilesView soldiers={soldiers} />}
      {view === "forms" && <FormsView tabs={forms} />}
      {view === "docs" && <DocsView sections={docs} />}
    </main>
  );
}
