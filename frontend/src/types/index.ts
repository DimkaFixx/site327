export type Audience = string;

export type AccessRule = {
  ranks: string[];
  specializations: string[];
  positions: string[];
};

export type AccessGroup = AccessRule & {
  id: string;
  title: string;
};

export type AccessGroupPayload = AccessRule & {
  id?: string;
  title: string;
};

export type AccessRules = {
  groups: AccessGroup[];
  instructors: AccessRule;
  officers: AccessRule;
};

export type Soldier = {
  id: string;
  nickname: string;
  rank: string;
  number: string;
  combat_deployments: string;
  service_time: string;
  unit: string;
  position: string;
  status: string;
  raw: Record<string, unknown>;
};

export type FormItem = {
  id: string;
  title: string;
  url: string;
  tab_id: string;
  description: string;
  audience: Audience;
  active: boolean;
};

export type FormTab = {
  id: string;
  title: string;
  audience: Audience;
  forms: FormItem[];
};

export type DocItem = {
  id: string;
  title: string;
  section_id: string;
  audience: Audience;
  content: string;
  description: string;
  active: boolean;
};

export type DocsSection = {
  id: string;
  title: string;
  audience: Audience;
  docs: DocItem[];
};

export type HomePage = {
  title: string;
  content: string;
};

export type Session = {
  token: string;
  refresh_token: string;
  profile: Soldier;
  is_admin: boolean;
  is_officer: boolean;
  is_instructor: boolean;
  access_groups: string[];
  form_access_groups: string[];
  doc_access_groups: string[];
  requires_password_setup: boolean;
  requires_discord_verification: boolean;
  verification_resend_available_in: number;
  verification_sends_remaining: number;
  discord_delivery_failed: boolean;
};

export type UserAccount = {
  nickname: string;
  has_password: boolean;
  is_admin: boolean;
  is_default_admin: boolean;
};

export type VerificationCodeAdminItem = {
  nickname: string;
  discord_id: string;
  code: string;
  send_count: number;
  attempt_count: number;
  expires_at: string;
  locked_until: string | null;
};

export type AuditEventItem = {
  id: number;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  created_at: string;
};
