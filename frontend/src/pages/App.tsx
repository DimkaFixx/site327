import { BadgeCheck, BookOpenText, Check, ClipboardList, Copy, ExternalLink, GripVertical, ImageUp, LogOut, Menu, Package, Search, Shield, UserRound, UsersRound, X } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, ComponentPropsWithoutRef, Dispatch, ReactNode, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import type { AccessGroup, AccessGroupPayload, AccessRules, AuditEventItem, Audience, CompetenciesResponse, DocItem, DocsSection, EquipmentItem, EquipmentResponse, FormItem, FormTab, HomePage, ManualRegulation, MarkdownSettings, RegulationsStore, Session, Soldier, UserAccount, VerificationCodeAdminItem } from "../types";

type View = "me" | "equipment" | "competencies" | "profiles" | "forms" | "docs";
type FormsAdminSheet = "view" | "create" | "edit";
type DocsAdminSheet = "view" | "create";

const defaultMarkdownSettings: MarkdownSettings = {
  font_size: 16,
  line_height: 1.65,
  content_padding: 28,
  h1_font_size: 38,
  h2_font_size: 34,
  h3_font_size: 26,
  code_font_size: 14,
  paragraph_spacing: 16,
  heading_margin_top: 28,
  heading_margin_bottom: 14,
};

function markdownSettingsStyle(settings: MarkdownSettings): React.CSSProperties {
  return {
    "--markdown-font-size": `${settings.font_size}px`,
    "--markdown-line-height": String(settings.line_height),
    "--markdown-padding": `${settings.content_padding}px`,
    "--markdown-h1-size": `${settings.h1_font_size}px`,
    "--markdown-h2-size": `${settings.h2_font_size}px`,
    "--markdown-h3-size": `${settings.h3_font_size}px`,
    "--markdown-code-size": `${settings.code_font_size}px`,
    "--markdown-paragraph-spacing": `${settings.paragraph_spacing}px`,
    "--markdown-heading-margin-top": `${settings.heading_margin_top}px`,
    "--markdown-heading-margin-bottom": `${settings.heading_margin_bottom}px`,
  } as React.CSSProperties;
}

function emptyDocDraft(sectionId = ""): Omit<DocItem, "id"> {
  return {
    title: "",
    section_id: sectionId,
    audience: "public",
    document_type: "page",
    url: "",
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

function MarkdownCode({ children, className, node: _node, ...props }: ComponentPropsWithoutRef<"code"> & { children?: ReactNode; node?: unknown }) {
  return <code className={className} {...props}>{children}</code>;
}

function markdownNodeText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(markdownNodeText).join("");
  if (React.isValidElement(value)) return markdownNodeText((value.props as { children?: ReactNode }).children);
  return "";
}

function MarkdownPre({ children, node: _node, ...props }: ComponentPropsWithoutRef<"pre"> & { children?: ReactNode; node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const code = markdownNodeText(children).replace(/\n$/, "");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="markdown-code-container">
      <pre {...props}>{children}</pre>
      <button className="copy-code-button" type="button" onClick={copyCode} title="Скопировать код" aria-label="Скопировать код">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
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
      code: MarkdownCode,
      pre: MarkdownPre,
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
  const awardValue = Object.entries(profile.raw).find(([key]) => normalizeProfileFieldKey(key) === "наг")?.[1];
  const awardStatus = String(awardValue ?? "").trim().toLocaleLowerCase();
  const hasAwardForm = awardStatus === "true" || awardStatus === "1" || awardStatus === "да";
  return [
    ["Ник", profile.nickname],
    ["Звание", profile.rank],
    ["Номер", profile.number],
    ["Отпуск/Мороз", String(profile.raw["Отпуск/Мороз"] || "")],
    ["Специализация", String(profile.raw["Специализация"] || profile.raw["Спец-я"] || "")],
    ["Должность", profile.position],
    ["Статус", profile.status],
    awardValue !== undefined ? ["Наградная форма", hasAwardForm ? "✓" : "✕"] : null,
  ].filter((row): row is [string, string] => Array.isArray(row) && Boolean(String(row[1] || "").trim()));
}

function formatProfileValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (normalized === "true") return "Да";
  if (normalized === "false") return "Нет";
  return String(value || "-");
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

function normalizeProfileFieldKey(value: string) {
  return value.toLocaleLowerCase().replace(/[\s_/-]+/g, "").replace(/ё/g, "е");
}

const compactProfileFieldKeys = new Set([
  "ник",
  "никнейм",
  "nickname",
  "позывной",
  "звание",
  "rank",
  "номер",
  "number",
  "отпускмороз",
  "специализация",
  "спеця",
  "должность",
  "position",
  "статус",
  "status",
  "наг",
]);

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
  const [markdownSettings, setMarkdownSettings] = useState<MarkdownSettings>(defaultMarkdownSettings);
  const [error, setError] = useState("");

  useEffect(() => {
    api.home()
      .then(setPage)
      .catch((error) => setError(error instanceof Error ? error.message : "Не удалось загрузить главную страницу"));
  }, []);

  useEffect(() => {
    api.docsSettings().then(setMarkdownSettings).catch(() => undefined);
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
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {!error && !page && <div className="empty">Загрузка главной...</div>}
      {page && (
        <article className="markdown-document full-document" style={markdownSettingsStyle(markdownSettings)}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCode, pre: MarkdownPre }}>{page.content || "_Главная страница пустая._"}</ReactMarkdown>
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
  const uniqueDetails = details.filter(([key]) => !compactProfileFieldKeys.has(normalizeProfileFieldKey(key)));
  const hasExpandedInfo = uniqueDetails.length > 0 || summary.length > 0;
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
            <strong>{formatProfileValue(value)}</strong>
          </div>
        ))}
      </div>
      {hasExpandedInfo && (
        <details>
          <summary>Расширенная информация</summary>
          {uniqueDetails.length > 0 && (
            <div className="raw-section">
              <h3>Данные бойца</h3>
              <div className="raw-grid">
                {uniqueDetails.map(([key, value]) => (
                  <p key={key}>
                    <span>{key}</span>
                    <b>{formatProfileValue(value)}</b>
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
                    <b>{formatProfileValue(value)}</b>
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

function EquipmentView({ equipment, error }: { equipment: EquipmentResponse | null; error: string }) {
  const [openedImage, setOpenedImage] = useState<{ url: string; label: string } | null>(null);
  if (!equipment) return <div className="empty">{error || "Загрузка регламента снаряжения..."}</div>;
  const formatValue = (value: string) => value.replace(/\s*\/\/\s*/g, "\n").trim();
  return (
    <section className="equipment-view">
      <section className="equipment-regulation">
        <div className="equipment-content">
          <div className="document-header equipment-header">
            <span>{equipment.rank_group}</span>
            <h2>{equipment.regulation}</h2>
            <p>Регламент снаряжения подобран по вашей приписке, специализации и званию.</p>
          </div>
          <div className="equipment-panel">
            {equipment.equipment.length === 0 && <div className="empty">Для выбранного регламента пока нет перечня снаряжения.</div>}
            {equipment.equipment.map((item, index) => (
              <div className={`equipment-row${item.is_award ? " award-equipment-row" : ""}`} key={`${item.category}-${index}`}>
                <strong><span>{item.category}</span>{item.is_award && <small>Наградная форма</small>}</strong>
                <p>{formatValue([item.amount, item.value].filter(Boolean).join("\n"))}</p>
              </div>
            ))}
          </div>
        </div>
        {(equipment.image_url || equipment.award_image_url) && <div className="equipment-image-stack">
          {equipment.image_url && (
            <button className="equipment-image-button" type="button" onClick={() => setOpenedImage({ url: equipment.image_url, label: `Комплект: ${equipment.regulation}` })} aria-label="Увеличить изображение комплекта">
              <img className="equipment-image" src={equipment.image_url} alt={`Комплект: ${equipment.regulation}`} />
            </button>
          )}
          {equipment.award_image_url && (
            <button className="equipment-image-button" type="button" onClick={() => setOpenedImage({ url: equipment.award_image_url, label: "Наградная форма" })} aria-label="Увеличить изображение наградной формы">
              <img className="equipment-image" src={equipment.award_image_url} alt="Наградная форма" />
            </button>
          )}
        </div>}
      </section>
      <section className="medicine-section">
        <h2>{equipment.medicine_title}</h2>
        <div className="equipment-panel">
          {equipment.medicine.length === 0 && <div className="empty">Регламент медицины не найден.</div>}
          {equipment.medicine.map((item, index) => (
            <div className="equipment-row" key={`${item.category}-${index}`}>
              <strong>{item.category}</strong>
              <p>{formatValue([item.amount, item.value].filter(Boolean).join("\n"))}</p>
            </div>
          ))}
        </div>
      </section>
      {openedImage && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpenedImage(null)}>
          <section className="access-modal equipment-image-modal" role="dialog" aria-modal="true" aria-label={openedImage.label} onMouseDown={(event) => event.stopPropagation()}>
            <button className="icon-button secondary-button equipment-image-close" type="button" onClick={() => setOpenedImage(null)} aria-label="Закрыть изображение"><X size={18} /></button>
            <img src={openedImage.url} alt={openedImage.label} />
          </section>
        </div>
      )}
    </section>
  );
}

function CompetenciesView({ competencies, error }: { competencies: CompetenciesResponse | null; error: string }) {
  if (!competencies) return <div className="empty">{error || "Загрузка компетенций..."}</div>;
  const groups = (items: CompetenciesResponse["attestations"]) => {
    const result = new Map<string, CompetenciesResponse["attestations"]>();
    for (const item of items) {
      const group = item.group || "Аттестации";
      result.set(group, [...(result.get(group) || []), item]);
    }
    return [...result.entries()];
  };
  const attestationGroups = groups(competencies.attestations);
  const techGroups = groups(competencies.tech_access);
  return (
    <section className="competencies-view">
      <div className="document-header">
        <span>Личный лист</span>
        <h2>Мои компетенции</h2>
        <p>Аттестации и допуски, отмеченные за вами в батальонном листе.</p>
      </div>
      <section className="competencies-section">
        <h3>Аттестации</h3>
        {attestationGroups.length === 0 ? <div className="empty">Аттестации пока не указаны.</div> : attestationGroups.map(([group, items]) => (
          <div className="competency-group" key={group}>
            {group && <p className="competency-group-title">{group}</p>}
            <div className="competency-chips">{items.map((item) => <span className={item.completed ? "" : "is-pending"} key={item.title}>{item.completed ? <Check size={15} /> : <X size={15} />}{item.title}<small>{item.completed ? "Пройдено" : "Не пройдено"}</small></span>)}</div>
          </div>
        ))}
      </section>
      <section className="competencies-section">
        <h3>Доступ к технике</h3>
        {techGroups.length === 0 ? <div className="empty">Допуски к технике пока не указаны.</div> : techGroups.map(([group, items]) => (
          <div className="competency-group" key={group}>
            {group && <p className="competency-group-title">{group}</p>}
            <div className="competency-chips">{items.map((item) => <span className={item.completed ? "" : "is-pending"} key={item.title}>{item.completed ? <BadgeCheck size={15} /> : <X size={15} />}{item.title}<small>{item.completed ? "Есть доступ" : "Нет доступа"}</small></span>)}</div>
          </div>
        ))}
      </section>
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
  const [isFormClosing, setIsFormClosing] = useState(false);
  const visibleTabs = useMemo(() => tabs.filter((tab) => tab.forms.length > 0), [tabs]);
  const current = visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab) && visibleTabs[0]) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [activeTab, visibleTabs]);

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

  function openFormModal(form: { title: string; url: string }) {
    setIsFormClosing(false);
    setOpenForm(form);
  }

  function closeFormModal() {
    if (isFormClosing) return;
    setIsFormClosing(true);
    window.setTimeout(() => {
      setOpenForm(null);
      setIsFormClosing(false);
    }, 160);
  }

  return (
    <section>
      <div className="tabs">
        {visibleTabs.map((tab) => (
          <button key={tab.id} className={current.id === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.title}
          </button>
        ))}
      </div>
      <div className="forms-grid">
        {current.forms.map((form) => (
          <article className="form-card" key={form.id}>
            <div>
              <span>{audienceLabel(form.audience)}</span>
              <h3>{form.title}</h3>
              {form.description && <p>{form.description}</p>}
            </div>
            <div className="form-actions">
              <button onClick={() => openFormModal({ title: form.title, url: form.url })}>Открыть</button>
              <a className="compact-link" href={form.url} target="_blank" rel="noreferrer">
                Перейти <ExternalLink size={14} />
              </a>
            </div>
          </article>
        ))}
      </div>
      {openForm && (
        <div className={`form-modal${isFormClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={openForm.title}>
          <div className="form-modal-bar">
            <h2>{openForm.title}</h2>
            <button className="icon-button" onClick={closeFormModal} title="Закрыть">
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
  const [openLinkDocument, setOpenLinkDocument] = useState<DocItem | null>(null);
  const [isLinkDocumentClosing, setIsLinkDocumentClosing] = useState(false);
  const virtualSections: DocsSection[] = useMemo(() => {
    const visibleSections = sections.filter((section) => section.docs.length > 0);
    const allDocs = visibleSections.flatMap((section) => section.docs);
    if (!allDocs.length) return [];
    return [
      { id: "all", title: "Все", audience: "public", docs: allDocs },
      ...visibleSections,
    ];
  }, [sections]);
  const currentSection = virtualSections.find((section) => section.id === activeSection) ?? virtualSections[0];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDocs = (currentSection?.docs ?? []).filter((doc) => {
    if (!normalizedQuery) return true;
    return [doc.title, doc.description, doc.content].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  useEffect(() => {
    if (!virtualSections.some((section) => section.id === activeSection)) {
      setActiveSection("all");
    }
  }, [activeSection, virtualSections]);

  function openLinkDocumentModal(doc: DocItem) {
    setIsLinkDocumentClosing(false);
    setOpenLinkDocument(doc);
  }

  function closeLinkDocumentModal() {
    if (isLinkDocumentClosing) return;
    setIsLinkDocumentClosing(true);
    window.setTimeout(() => {
      setOpenLinkDocument(null);
      setIsLinkDocumentClosing(false);
    }, 160);
  }

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
            doc.document_type === "link" ? (
              <div key={doc.id} className="external-doc-card">
                <button className="external-doc-main" type="button" onClick={() => openLinkDocumentModal(doc)}>
                  <strong>{doc.title}</strong>
                  <small>Внешний документ{doc.description ? ` · ${doc.description}` : ""}</small>
                </button>
                <a className="external-doc-open" href={doc.url} target="_blank" rel="noreferrer" aria-label={`Открыть «${doc.title}» в новой вкладке`} title="Открыть в новой вкладке">
                  <ExternalLink size={16} />
                </a>
              </div>
            ) : (
              <a key={doc.id} className="doc-link-card" href={`#/docs/${doc.id}`}>
                <strong>{doc.title}</strong>
                {doc.description && <small>{doc.description}</small>}
              </a>
            )
          ))}
        </div>
      </aside>
      {openLinkDocument && (
        <div className={`form-modal${isLinkDocumentClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={openLinkDocument.title}>
          <div className="form-modal-bar">
            <h2>{openLinkDocument.title}</h2>
            <div className="modal-actions">
              <a className="secondary-button compact-link" href={openLinkDocument.url} target="_blank" rel="noreferrer">Открыть <ExternalLink size={14} /></a>
              <button className="icon-button" onClick={closeLinkDocumentModal} title="Закрыть"><X size={20} /></button>
            </div>
          </div>
          <iframe src={openLinkDocument.url} title={openLinkDocument.title} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer">
            Загрузка...
          </iframe>
        </div>
      )}
    </section>
  );
}

function DocPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [markdownSettings, setMarkdownSettings] = useState<MarkdownSettings>(defaultMarkdownSettings);
  const [error, setError] = useState("");

  useEffect(() => {
    setDoc(null);
    setError("");
    Promise.all([api.doc(docId), api.docsSettings()])
      .then(([doc, settings]) => {
        setDoc(doc);
        setMarkdownSettings(settings);
      })
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
          <article className="markdown-document full-document" style={markdownSettingsStyle(markdownSettings)}>
            <div className="document-header">
              <span>{audienceLabel(doc.audience)}</span>
              <h2>{doc.title}</h2>
              {doc.description && <p>{doc.description}</p>}
            </div>
            {doc.document_type === "link" ? (
              <>
                <a className="ghost-link document-external-link" href={doc.url} target="_blank" rel="noreferrer">Открыть в новой вкладке <ExternalLink size={16} /></a>
                <iframe className="document-link-frame" src={doc.url} title={doc.title} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer">
                  Загрузка...
                </iframe>
              </>
            ) : <MarkdownWithOutline content={doc.content} />}
          </article>
          {doc.document_type !== "link" && <DocumentOutline content={doc.content} />}
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
  const [markdownSettings, setMarkdownSettings] = useState<MarkdownSettings>(defaultMarkdownSettings);
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
        setMarkdownSettings(store.markdown_settings);
        setDocAccessRules(rules);
        setDocDraft({
          title: doc.title,
          section_id: doc.section_id,
          audience: doc.audience,
          document_type: doc.document_type,
          url: doc.url || "",
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
                <button disabled={saving || !docDraft.title.trim() || !docDraft.section_id || (docDraft.document_type === "link" && !docDraft.url.trim())}>{saving ? "Сохранение..." : "Сохранить"}</button>
                <a className="secondary-button row-link-button" href={`#/docs/${docId}`}>К документу</a>
                {savedMessage && <small>{savedMessage}</small>}
              </div>
            </div>
            <article className="markdown-document editor-preview" style={markdownSettingsStyle(markdownSettings)}>
              <div className="document-header">
                <span>{audienceLabel(docDraft.audience, docAccessRules.groups)}</span>
                <h2>{docDraft.title || "Без названия"}</h2>
                {docDraft.description && <p>{docDraft.description}</p>}
              </div>
              {docDraft.document_type === "link" ? (
                <p>{docDraft.url || "Укажите ссылку на внешний документ."}</p>
              ) : <ReactMarkdown remarkPlugins={[remarkGfm]}>{docDraft.content || "_Документ пустой._"}</ReactMarkdown>}
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
  const pendingSelectionRef = useRef<{ position: number; scrollTop: number } | null>(null);

  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea) return;
    pendingSelectionRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(selection.position, selection.position);
    textarea.scrollTop = selection.scrollTop;
  }, [value]);

  function restoreEditorPosition(cursorPosition: number, scrollTop: number) {
    pendingSelectionRef.current = { position: cursorPosition, scrollTop };
  }

  function insertText(text: string, start: number, end: number, scrollTop: number) {
    setValue((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
    restoreEditorPosition(start + text.length, scrollTop);
  }

  function replaceInsertedText(search: string, replacement: string, preferredStart: number, scrollTop: number) {
    setValue((current) => {
      // Keep the replacement tied to the place where the image was pasted.
      // Searching from the beginning could move the caret to another matching
      // placeholder (or to the document start) when the editor contained more
      // than one upload in progress.
      const atPreferredPosition = current.slice(preferredStart, preferredStart + search.length) === search;
      const index = atPreferredPosition ? preferredStart : current.indexOf(search);
      if (index < 0) {
        pendingSelectionRef.current = { position: current.length, scrollTop };
        return current;
      }
      pendingSelectionRef.current = { position: index + replacement.length, scrollTop };
      return `${current.slice(0, index)}${replacement}${current.slice(index + search.length)}`;
    });
  }

  async function uploadMarkdownImage(file: File, start: number, end: number) {
    const alt = ((file.name || "image").replace(/\.[^.]+$/, "") || "image").replace(/[[\]()]/g, " ");
    const placeholder = `![${alt}](загрузка...)`;
    const scrollTop = textareaRef.current?.scrollTop ?? 0;
    insertText(placeholder, start, end, scrollTop);
    try {
      const result = await api.uploadImage(file);
      replaceInsertedText(placeholder, `![${alt}](${result.url})`, start, scrollTop);
    } catch {
      replaceInsertedText(placeholder, `<!-- Не удалось загрузить изображение: ${alt} -->`, start, scrollTop);
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
      <select value={docDraft.document_type} onChange={(event) => setDocDraft({ ...docDraft, document_type: event.target.value as "page" | "link" })}>
        <option value="page">Обычный документ</option>
        <option value="link">Внешняя ссылка</option>
      </select>
      {docDraft.document_type === "link" ? (
        <input type="url" value={docDraft.url} onChange={(event) => setDocDraft({ ...docDraft, url: event.target.value })} placeholder="https://example.com/документ" />
      ) : (
        <MarkdownEditorTextarea
          value={docDraft.content}
          setValue={(next) =>
            setDocDraft((current) => ({
              ...current,
              content: typeof next === "function" ? next(current.content) : next,
            }))
          }
        />
      )}
    </>
  );
}

function AdminPanel({ session, onAdminAccessDenied }: { session: Session; onAdminAccessDenied: () => void }) {
  const [store, setStore] = useState<FormTab[]>([]);
  const [docsStore, setDocsStore] = useState<DocsSection[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [verificationCodes, setVerificationCodes] = useState<VerificationCodeAdminItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isSynchronizing, setIsSynchronizing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
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
    document_type: "page",
    url: "",
    content: "",
    description: "",
    active: true,
  });
  const [docsAdminSheet, setDocsAdminSheet] = useState<DocsAdminSheet>("view");
  const [markdownSettings, setMarkdownSettings] = useState<MarkdownSettings>(defaultMarkdownSettings);
  const [isMarkdownSettingsOpen, setIsMarkdownSettingsOpen] = useState(false);
  const [isMarkdownSettingsSaving, setIsMarkdownSettingsSaving] = useState(false);
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
    setMarkdownSettings(docsResult.markdown_settings);
    setUsers(accounts);
    setVerificationCodes(codes);
    setAuditEvents(audit);
    setAccessRules(rules);
    setDocAccessRules(docRules);
    setForm((current) => ({ ...current, tab_id: current.tab_id || result.tabs[0]?.id || "" }));
    setDocDraft((current) => ({ ...current, section_id: current.section_id || docsResult.sections[0]?.id || "" }));
  }

  useEffect(() => {
    refresh().catch((error) => {
      const message = error instanceof Error ? error.message : "Ошибка загрузки";
      if (message === "Admin access required") {
        onAdminAccessDenied();
        return;
      }
      setError(message);
    });
  }, [onAdminAccessDenied]);

  async function addTab(event: FormEvent) {
    event.preventDefault();
    await api.createTab(tabTitle, tabAudience);
    setTabTitle("");
    await refresh();
  }

  async function synchronizeSheets() {
    setIsSynchronizing(true);
    setError("");
    setSyncMessage("");
    try {
      const [soldiers, competencies] = await Promise.all([api.syncSoldiersAndEquipment(), api.syncCompetencies()]);
      await refresh();
      setSyncMessage(`Обновлены: состав — ${soldiers.soldiers}, компетенции — ${competencies.rows} строк.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось обновить данные из Google Sheets");
    } finally {
      setIsSynchronizing(false);
    }
  }

  async function saveMarkdownSettings(event: FormEvent) {
    event.preventDefault();
    setIsMarkdownSettingsSaving(true);
    try {
      const saved = await api.updateDocsSettings(markdownSettings);
      setMarkdownSettings(saved);
      setIsMarkdownSettingsOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить настройки Markdown");
    } finally {
      setIsMarkdownSettingsSaving(false);
    }
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
    const updated = await api.updateUserRoles(user.nickname, isAdmin);
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
          <button className="secondary-button" onClick={() => void synchronizeSheets()} disabled={isSynchronizing}>{isSynchronizing ? "Обновление..." : "Обновить данные"}</button>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {syncMessage && <div className="notice">{syncMessage}</div>}
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
        <div className="section-heading-row">
          <div>
            <h2>Сервисы</h2>
            <p>Внутренние инструменты для работы с материалами батальона.</p>
          </div>
          <div className="row-actions">
            <a className="secondary-button row-link-button" href="#/ghost-admin/regulations"><Package size={16} /> Регламенты</a>
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
        <div className="section-heading-row">
          <h2>Документация</h2>
          <button className="secondary-button" onClick={() => setIsMarkdownSettingsOpen(true)}>Настроить .md</button>
        </div>
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
                        <span>{doc.title} <small>{doc.document_type === "link" ? "Внешняя ссылка · " : ""}{audienceLabel(doc.audience, docAccessRules.groups)}</small></span>
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
            <button disabled={!docDraft.title.trim() || !docDraft.section_id || (docDraft.document_type === "link" && !docDraft.url.trim())}>Добавить документ</button>
          </form>
        )}
      </section>
      {isMarkdownSettingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsMarkdownSettingsOpen(false)}>
          <section className="access-modal markdown-settings-modal" role="dialog" aria-modal="true" aria-labelledby="markdown-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-modal-bar">
              <h2 id="markdown-settings-title">Настройки Markdown</h2>
              <button className="icon-button secondary-button" onClick={() => setIsMarkdownSettingsOpen(false)} aria-label="Закрыть настройки"><X size={18} /></button>
            </div>
            <form className="access-modal-body markdown-settings-form" onSubmit={saveMarkdownSettings}>
              <label>Размер основного текста, px<input type="number" min="12" max="28" value={markdownSettings.font_size} onChange={(event) => setMarkdownSettings({ ...markdownSettings, font_size: Number(event.target.value) })} /></label>
              <label>Межстрочный интервал<input type="number" min="1.2" max="2.2" step="0.05" value={markdownSettings.line_height} onChange={(event) => setMarkdownSettings({ ...markdownSettings, line_height: Number(event.target.value) })} /></label>
              <label>Внутренний отступ документа, px<input type="number" min="16" max="64" value={markdownSettings.content_padding} onChange={(event) => setMarkdownSettings({ ...markdownSettings, content_padding: Number(event.target.value) })} /></label>
              <label>Размер заголовка H1, px<input type="number" min="24" max="64" value={markdownSettings.h1_font_size} onChange={(event) => setMarkdownSettings({ ...markdownSettings, h1_font_size: Number(event.target.value) })} /></label>
              <label>Размер заголовка H2, px<input type="number" min="20" max="56" value={markdownSettings.h2_font_size} onChange={(event) => setMarkdownSettings({ ...markdownSettings, h2_font_size: Number(event.target.value) })} /></label>
              <label>Размер заголовка H3, px<input type="number" min="18" max="48" value={markdownSettings.h3_font_size} onChange={(event) => setMarkdownSettings({ ...markdownSettings, h3_font_size: Number(event.target.value) })} /></label>
              <label>Размер кода, px<input type="number" min="10" max="24" value={markdownSettings.code_font_size} onChange={(event) => setMarkdownSettings({ ...markdownSettings, code_font_size: Number(event.target.value) })} /></label>
              <label>Отступ между абзацами, px<input type="number" min="6" max="32" value={markdownSettings.paragraph_spacing} onChange={(event) => setMarkdownSettings({ ...markdownSettings, paragraph_spacing: Number(event.target.value) })} /></label>
              <label>Отступ над заголовком, px<input type="number" min="8" max="64" value={markdownSettings.heading_margin_top} onChange={(event) => setMarkdownSettings({ ...markdownSettings, heading_margin_top: Number(event.target.value) })} /></label>
              <label>Отступ под заголовком, px<input type="number" min="4" max="40" value={markdownSettings.heading_margin_bottom} onChange={(event) => setMarkdownSettings({ ...markdownSettings, heading_margin_bottom: Number(event.target.value) })} /></label>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={() => setIsMarkdownSettingsOpen(false)}>Отмена</button>
                <button disabled={isMarkdownSettingsSaving}>{isMarkdownSettingsSaving ? "Сохранение..." : "Сохранить"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
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
                  disabled={user.is_default_admin || user.nickname.trim().replaceAll("`", "").toLocaleLowerCase() === session.profile.nickname.trim().replaceAll("`", "").toLocaleLowerCase()}
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

const regulationCategories = ["Шлем", "Форма", "Жилет", "Рюкзак", "Осн. оружие", "Вторичное оружие", "Пистолет", "Гранаты", "ПНВ", "Доп"];

function blankRegulation(title = "Новый регламент"): ManualRegulation {
  return {
    id: `regulation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    image_url: "",
    is_award: false,
    assignments: [],
    specializations: [],
    ranks: [],
    positions: [],
    items: [],
  };
}

function RegulationEditor({ regulation, onChange, onRemove, removable, isMedicine = false }: { regulation: ManualRegulation; onChange: (next: ManualRegulation) => void; onRemove?: () => void; removable?: boolean; isMedicine?: boolean }) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [filterText, setFilterText] = useState({
    assignments: regulation.assignments.join(", "),
    specializations: regulation.specializations.join(", "),
    ranks: regulation.ranks.join(", "),
    positions: regulation.positions.join(", "),
  });
  useEffect(() => {
    setFilterText({
      assignments: regulation.assignments.join(", "),
      specializations: regulation.specializations.join(", "),
      ranks: regulation.ranks.join(", "),
      positions: regulation.positions.join(", "),
    });
  }, [regulation.id]);
  const toList = (value: string) => value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  const updateFilter = (field: "assignments" | "specializations" | "ranks" | "positions", value: string) => {
    setFilterText((current) => ({ ...current, [field]: value }));
    onChange({ ...regulation, [field]: toList(value) });
  };
  const updateItems = (items: EquipmentItem[]) => onChange({ ...regulation, items });
  const pasteTable = (event: ClipboardEvent<HTMLElement>) => {
    const text = event.clipboardData.getData("text/plain");
    const lines = text.replace(/\r/g, "").split("\n");
    if (!text.includes("\t")) return;
    event.preventDefault();
    if (isMedicine) {
      const imported: EquipmentItem[] = [];
      let current: EquipmentItem | null = null;
      for (const line of lines) {
        const cells = line.split("\t").map((cell) => cell.replaceAll('"', "").trim());
        const hasImageColumn = cells.length >= 4 && (!cells[0] || /^=IMAGE\(|^https?:\/\//i.test(cells[0]));
        const offset = hasImageColumn ? 1 : 0;
        const category = cells[offset] || "";
        const amount = cells[offset + 1] || "";
        const note = cells.slice(offset + 2).join("\t").trim();
        if (category && (cells.length >= offset + 2)) {
          if (current) imported.push(current);
          current = { category, amount, value: note, image_url: "" };
        } else if (current) {
          const continuation = cells.join("\t").trim();
          if (continuation) current.value = `${current.value}${current.value ? "\n" : ""}${continuation}`;
        }
      }
      if (current) imported.push(current);
      if (imported.length) updateItems(imported);
      return;
    }
    const categoryKey = (value: string) => value.toLowerCase().replace(/[\s.]/g, "");
    const knownCategory = (value: string) => regulationCategories.find((category) => categoryKey(category) === categoryKey(value));
    const imported: EquipmentItem[] = [];
    let current: EquipmentItem | null = null;
    for (const line of lines) {
      const cells = line.split("\t").map((cell) => cell.replaceAll('"', "").trim());
      const categoryIndex = cells.findIndex((cell) => Boolean(knownCategory(cell.trim())));
      if (categoryIndex >= 0) {
        if (current) imported.push(current);
        current = {
          category: knownCategory(cells[categoryIndex].trim()) || cells[categoryIndex].trim(),
          value: cells.slice(categoryIndex + 1).join("\t").trim(),
          amount: "",
          image_url: "",
        };
      } else if (current) {
        const continuation = cells.join("\t").trim();
        if (continuation) current.value = `${current.value}${current.value ? "\n" : ""}${continuation}`;
      }
    }
    if (current) imported.push(current);
    if (imported.length) updateItems(imported);
  };
  async function uploadImage(file: File) {
    setIsUploading(true);
    try {
      const result = await api.uploadImage(file);
      onChange({ ...regulation, image_url: result.url });
    } finally {
      setIsUploading(false);
    }
  }
  return (
    <article className="regulation-editor" onPasteCapture={pasteTable}>
      <div className="section-heading-row">
        <input value={regulation.title} onChange={(event) => onChange({ ...regulation, title: event.target.value })} placeholder="Название регламента" />
        {removable && <button className="danger-button" type="button" onClick={onRemove}>Удалить</button>}
      </div>
      <div className="regulation-filters">
        <label>Приписки<input value={filterText.assignments} onChange={(event) => updateFilter("assignments", event.target.value)} placeholder="ARC, ARF, ARC-..." /></label>
        <label>Специализации<input value={filterText.specializations} onChange={(event) => updateFilter("specializations", event.target.value)} placeholder="M, HM, MS" /></label>
        {!isMedicine && <label>Звания<input value={filterText.ranks} onChange={(event) => updateFilter("ranks", event.target.value)} placeholder="PVT, CPL, SGT" /></label>}
        {!isMedicine && <label>Должности<input value={filterText.positions} onChange={(event) => updateFilter("positions", event.target.value)} placeholder="Командир отряда" /></label>}
      </div>
      {!isMedicine && <label className="award-regulation-toggle"><input type="checkbox" checked={regulation.is_award} onChange={(event) => onChange({ ...regulation, is_award: event.target.checked })} />Наградная форма — показывается дополнительно только бойцам с отметкой «Наг»</label>}
      {!isMedicine && <>
        <button className="regulation-photo-dropzone" type="button" onClick={() => imageInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file?.type.startsWith("image/")) void uploadImage(file);
        }} disabled={isUploading}>
          <ImageUp size={20} />
          <span>{isUploading ? "Загрузка фото..." : regulation.image_url ? "Заменить фото комплекта" : "Перетащите фото комплекта сюда или нажмите для выбора"}</span>
        </button>
        <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadImage(file);
          event.target.value = "";
        }} />
      </>}
      <textarea className="regulation-paste-input" onPaste={pasteTable} placeholder={isMedicine ? "Вставьте из Google Sheets колонки: пункт, количество, описание" : "Вставьте из Google Sheets колонки: категория, содержимое"} />
      <p className="regulation-paste-hint">Нажмите Ctrl+V в это поле — строки сразу распределятся по пунктам. Для комплекта также поддерживается первый столбец с фото.</p>
      {isMedicine && <div className="medicine-column-headings"><span>Пункт</span><span>Количество</span><span>Примечание</span><span /></div>}
      <div className="regulation-items">
        {regulation.items.map((item, index) => (
          <div className={`regulation-item${isMedicine ? " medicine-item" : ""}`} key={`${item.category}-${index}`}>
            <input value={item.category} onChange={(event) => updateItems(regulation.items.map((current, currentIndex) => currentIndex === index ? { ...current, category: event.target.value } : current))} placeholder="Категория" />
            {isMedicine && <input value={item.amount} onChange={(event) => updateItems(regulation.items.map((current, currentIndex) => currentIndex === index ? { ...current, amount: event.target.value } : current))} placeholder="Количество" />}
            <textarea value={item.value} onChange={(event) => updateItems(regulation.items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} placeholder={isMedicine ? "Описание" : "Снаряжение"} />
            <button className="icon-button secondary-button" type="button" aria-label="Удалить пункт" onClick={() => updateItems(regulation.items.filter((_, currentIndex) => currentIndex !== index))}><X size={16} /></button>
          </div>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => updateItems([...regulation.items, { category: "", value: "", amount: "", image_url: "" }])}>Добавить пункт</button>
    </article>
  );
}

function RegulationsPage() {
  const [store, setStore] = useState<RegulationsStore | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<{ kind: "equipment" | "medicine" | "base"; index?: number } | null>(null);
  const [draggedEquipmentIndex, setDraggedEquipmentIndex] = useState<number | null>(null);
  useEffect(() => {
    api.regulations().then(setStore).catch((error) => setError(error instanceof Error ? error.message : "Не удалось загрузить регламенты"));
  }, []);
  if (!store) return <main className="shell"><div className="empty">{error || "Загрузка регламентов..."}</div></main>;
  const save = async () => {
    setIsSaving(true);
    setError("");
    try {
      setStore(await api.updateRegulations(store));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить регламенты");
    } finally {
      setIsSaving(false);
    }
  };
  const updateEquipment = (index: number, next: ManualRegulation) => setStore({ ...store, equipment: store.equipment.map((item, itemIndex) => itemIndex === index ? next : item) });
  const updateMedicine = (index: number, next: ManualRegulation) => setStore({ ...store, medicine_rules: store.medicine_rules.map((item, itemIndex) => itemIndex === index ? next : item) });
  const moveEquipment = (from: number, to: number) => {
    if (from === to) return;
    const equipment = [...store.equipment];
    const [moved] = equipment.splice(from, 1);
    equipment.splice(to, 0, moved);
    setStore({ ...store, equipment });
  };
  const editingRule = editing?.kind === "equipment" ? store.equipment[editing.index ?? 0] : editing?.kind === "medicine" ? store.medicine_rules[editing.index ?? 0] : editing?.kind === "base" ? store.medicine_base : null;
  const updateEditingRule = (next: ManualRegulation) => {
    if (editing?.kind === "equipment") updateEquipment(editing.index ?? 0, next);
    if (editing?.kind === "medicine") updateMedicine(editing.index ?? 0, next);
    if (editing?.kind === "base") setStore({ ...store, medicine_base: next });
  };
  const ruleCard = (rule: ManualRegulation, onEdit: () => void) => (
    <article className="regulation-card" key={rule.id}>
      <div><h3>{rule.title}</h3><p>{rule.items.filter((item) => item.value.trim() || item.amount.trim()).length} заполненных пунктов · {rule.image_url ? "фото прикреплено" : "без фото"}{rule.is_award ? " · наградная форма" : ""}</p></div>
      <button className="secondary-button" type="button" onClick={onEdit}>Редактировать</button>
    </article>
  );
  return (
    <main className="shell regulations-page">
      <header className="topbar"><div><p className="eyebrow">Админка</p><h1>Регламенты</h1></div><a className="ghost-link" href="#/ghost-admin">К админке</a></header>
      <p className="regulations-intro">Настройте правила показа и вставляйте данные снаряжения из таблицы напрямую. Регламент с наибольшим числом совпавших условий получит приоритет.</p>
      {error && <div className="alert">{error}</div>}
      <section className="admin-section"><div className="section-heading-row"><div><h2>Снаряжение</h2><p>Если фильтры пустые, регламент является общим.</p></div><button type="button" onClick={() => { setStore({ ...store, equipment: [...store.equipment, blankRegulation()] }); setEditing({ kind: "equipment", index: store.equipment.length }); }}>Добавить регламент</button></div>
        <div className="regulation-cards">{store.equipment.map((rule, index) => (
          <article
            className={`regulation-card regulation-card-draggable${draggedEquipmentIndex === index ? " is-dragging" : ""}`}
            key={rule.id}
            draggable
            onDragStart={(event) => { setDraggedEquipmentIndex(index); event.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDraggedEquipmentIndex(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (draggedEquipmentIndex !== null) moveEquipment(draggedEquipmentIndex, index); setDraggedEquipmentIndex(null); }}
          >
            <button className="regulation-card-drag-handle" type="button" aria-label="Перетащить комплект" tabIndex={-1}><GripVertical size={20} /></button>
            <div><h3>{rule.title}</h3><p>{rule.items.filter((item) => item.value.trim() || item.amount.trim()).length} заполненных пунктов · {rule.image_url ? "фото прикреплено" : "без фото"}{rule.is_award ? " · наградная форма" : ""}</p></div>
            <button className="secondary-button" type="button" onClick={() => setEditing({ kind: "equipment", index })}>Редактировать</button>
          </article>
        ))}</div>
      </section>
      <section className="admin-section"><h2>Медицина</h2><p className="regulations-intro">Базовый регламент получают все. Правила ниже заменяют его при совпадении условий.</p>
        <h3>Базовый регламент</h3>
        <div className="regulation-cards">{ruleCard(store.medicine_base, () => setEditing({ kind: "base" }))}</div>
        <div className="nonstandard-regulations"><div className="section-heading-row"><h3>Нестандартные регламенты</h3><button type="button" onClick={() => { setStore({ ...store, medicine_rules: [...store.medicine_rules, blankRegulation("Нестандартная медицина")] }); setEditing({ kind: "medicine", index: store.medicine_rules.length }); }}>Добавить регламент</button></div>
          <div className="regulation-cards">{store.medicine_rules.map((rule, index) => ruleCard(rule, () => setEditing({ kind: "medicine", index })))}</div></div>
      </section>
      <div className="form-actions"><button onClick={() => void save()} disabled={isSaving}>{isSaving ? "Сохранение..." : "Сохранить регламенты"}</button></div>
      {editing && editingRule && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}>
          <section className="access-modal regulation-modal" role="dialog" aria-modal="true" aria-label={`Редактирование: ${editingRule.title}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-modal-bar"><h2>Редактирование регламента</h2><button className="icon-button secondary-button" type="button" onClick={() => setEditing(null)} aria-label="Закрыть"><X size={18} /></button></div>
            <RegulationEditor regulation={editingRule} onChange={updateEditingRule} isMedicine={editing.kind === "base" || editing.kind === "medicine"} removable={editing.kind !== "base"} onRemove={() => {
              if (editing.kind === "equipment") setStore({ ...store, equipment: store.equipment.filter((_, index) => index !== editing.index) });
              if (editing.kind === "medicine") setStore({ ...store, medicine_rules: store.medicine_rules.filter((_, index) => index !== editing.index) });
              setEditing(null);
            }} />
          </section>
        </div>
      )}
    </main>
  );
}

export function App() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [session, setSession] = useState<Session | null>(storageSession);
  const [view, setView] = useState<View>("me");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLogoutConfirmationOpen, setIsLogoutConfirmationOpen] = useState(false);
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [equipment, setEquipment] = useState<EquipmentResponse | null>(null);
  const [equipmentError, setEquipmentError] = useState("");
  const [competencies, setCompetencies] = useState<CompetenciesResponse | null>(null);
  const [competenciesError, setCompetenciesError] = useState("");
  const [forms, setForms] = useState<FormTab[]>([]);
  const [docs, setDocs] = useState<DocsSection[]>([]);
  const isAdminRoute = route === "#/ghost-admin";
  const isRegulationsRoute = route === "#/ghost-admin/regulations";
  const isArchiveRoute = route === "#/archive";
  const isHomeEditRoute = route === "#/home/edit";
  const docEditRouteMatch = route.match(/^#\/docs\/([^/]+)\/edit$/);
  const docRouteMatch = route.match(/^#\/docs\/([^/]+)$/);
  const docEditRouteId = docEditRouteMatch ? decodeURIComponent(docEditRouteMatch[1]) : "";
  const docRouteId = docRouteMatch ? decodeURIComponent(docRouteMatch[1]) : "";
  const isAdminOnlyRoute = isAdminRoute || isRegulationsRoute || isHomeEditRoute || Boolean(docEditRouteId);

  const syncSession = useCallback(async () => {
    const updated = await api.me();
    api.saveSession(updated);
  }, []);

  const handleAdminAccessDenied = useCallback(() => {
    void syncSession().catch(() => api.clearSession());
  }, [syncSession]);

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
    if (!session || session.requires_discord_verification || session.requires_password_setup) return;
    const updateSession = () => {
      void syncSession().catch(() => api.clearSession());
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateSession();
    };

    updateSession();
    const interval = window.setInterval(updateSession, 15_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.profile.nickname, session?.requires_discord_verification, session?.requires_password_setup, syncSession]);

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
    api.equipment().then((result) => {
      setEquipment(result);
      setEquipmentError("");
    }).catch((error) => {
      setEquipment(null);
      setEquipmentError(error instanceof Error ? error.message : "Не удалось загрузить регламент снаряжения");
    });
    api.competencies().then((result) => {
      setCompetencies(result);
      setCompetenciesError("");
    }).catch((error) => {
      setCompetencies(null);
      setCompetenciesError(error instanceof Error ? error.message : "Не удалось загрузить компетенции");
    });
  }, [session, isArchiveRoute, isAdminRoute, isHomeEditRoute, docRouteId, docEditRouteId]);

  const currentProfile = useMemo(() => session?.profile ?? null, [session]);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setIsLogoutConfirmationOpen(false);
      setSession(null);
    }
  }

  function requestLogout() {
    setIsMobileMenuOpen(false);
    setIsLogoutConfirmationOpen(true);
  }

  function selectView(nextView: View) {
    setView(nextView);
    setIsMobileMenuOpen(false);
  }

  if (session?.requires_discord_verification) {
    return <DiscordVerification session={session} onComplete={setSession} onRestart={logout} />;
  }

  if (session?.requires_password_setup) {
    return <PasswordSetup session={session} onComplete={setSession} />;
  }

  if (isAdminRoute) {
    if (!session || !session.is_admin) return null;
    return <AdminPanel session={session} onAdminAccessDenied={handleAdminAccessDenied} />;
  }

  if (isRegulationsRoute) {
    if (!session || !session.is_admin) return null;
    return <RegulationsPage />;
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
    <main className={`shell${isMobileMenuOpen ? " mobile-menu-open" : ""}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">327 Star Corp</p>
          <h1>Батальонный архив</h1>
        </div>
        <div className="top-actions desktop-actions">
          <a className="ghost-link" href="#/">Главная</a>
          {session.is_admin && <a className="ghost-link" href="#/ghost-admin"><Shield size={16} /> Админка</a>}
          <button className="icon-button" onClick={requestLogout} title="Выйти"><LogOut size={18} /></button>
        </div>
        <button
          className="icon-button mobile-menu-toggle"
          type="button"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          aria-label={isMobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={isMobileMenuOpen}
          aria-controls="archive-mobile-menu"
        >
          {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      <nav className="nav desktop-nav">
        <button className={view === "me" ? "active" : ""} onClick={() => selectView("me")}><UserRound size={18} /> Мой профиль</button>
        <button className={view === "equipment" ? "active" : ""} onClick={() => selectView("equipment")}><Package size={18} /> Моё снаряжение</button>
        <button className={view === "competencies" ? "active" : ""} onClick={() => selectView("competencies")}><BadgeCheck size={18} /> Мои компетенции</button>
        <button className={view === "profiles" ? "active" : ""} onClick={() => selectView("profiles")}><UsersRound size={18} /> Профили</button>
        <button className={view === "forms" ? "active" : ""} onClick={() => selectView("forms")}><ClipboardList size={18} /> Формы</button>
        <button className={view === "docs" ? "active" : ""} onClick={() => selectView("docs")}><BookOpenText size={18} /> Документация</button>
      </nav>
      {isMobileMenuOpen && (
        <nav className="mobile-menu" id="archive-mobile-menu" aria-label="Навигация по архиву">
          <button className={view === "me" ? "active" : ""} onClick={() => selectView("me")}><UserRound size={18} /> Мой профиль</button>
          <button className={view === "equipment" ? "active" : ""} onClick={() => selectView("equipment")}><Package size={18} /> Моё снаряжение</button>
          <button className={view === "competencies" ? "active" : ""} onClick={() => selectView("competencies")}><BadgeCheck size={18} /> Мои компетенции</button>
          <button className={view === "profiles" ? "active" : ""} onClick={() => selectView("profiles")}><UsersRound size={18} /> Профили</button>
          <button className={view === "forms" ? "active" : ""} onClick={() => selectView("forms")}><ClipboardList size={18} /> Формы</button>
          <button className={view === "docs" ? "active" : ""} onClick={() => selectView("docs")}><BookOpenText size={18} /> Документация</button>
          <div className="mobile-menu-divider" aria-hidden="true" />
          <a href="#/" onClick={() => setIsMobileMenuOpen(false)}>Главная</a>
          {session.is_admin && <a href="#/ghost-admin" onClick={() => setIsMobileMenuOpen(false)}><Shield size={18} /> Админка</a>}
          <button className="mobile-logout" onClick={requestLogout}><LogOut size={18} /> Выйти</button>
        </nav>
      )}
      <div className="mobile-menu-content">
        {view === "me" && <ProfileCard profile={currentProfile} />}
        {view === "equipment" && <EquipmentView equipment={equipment} error={equipmentError} />}
        {view === "competencies" && <CompetenciesView competencies={competencies} error={competenciesError} />}
        {view === "profiles" && <ProfilesView soldiers={soldiers} />}
        {view === "forms" && <FormsView tabs={forms} />}
        {view === "docs" && <DocsView sections={docs} />}
      </div>
      {isLogoutConfirmationOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsLogoutConfirmationOpen(false)}>
          <section className="access-modal logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirmation-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-modal-bar">
              <h2 id="logout-confirmation-title">Выйти из аккаунта?</h2>
              <button className="icon-button secondary-button" onClick={() => setIsLogoutConfirmationOpen(false)} aria-label="Закрыть подтверждение"><X size={18} /></button>
            </div>
            <div className="access-modal-body">
              <p>Для повторного входа потребуется авторизация.</p>
              <div className="form-actions">
                <button className="secondary-button" onClick={() => setIsLogoutConfirmationOpen(false)}>Отмена</button>
                <button className="danger-button" onClick={logout}><LogOut size={18} /> Выйти</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
