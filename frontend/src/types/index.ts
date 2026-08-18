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
  online: OnlineStats;
};

export type OnlineDay = {
  date: string;
  server_1_hours: number;
  server_2_hours: number;
  total_hours: number;
};

export type OnlineStats = {
  days: OnlineDay[];
  weekly: Record<string, string>;
};

export type EquipmentItem = {
  category: string;
  value: string;
  amount: string;
  image_url: string;
  is_award?: boolean;
};

export type EquipmentResponse = {
  regulation: string;
  rank_group: string;
  image_url: string;
  award_image_url: string;
  equipment: EquipmentItem[];
  medicine_title: string;
  medicine: EquipmentItem[];
  engineer_title: string;
  engineer: EquipmentItem[];
};

export type ManualRegulation = {
  id: string;
  title: string;
  image_url: string;
  is_award: boolean;
  assignments: string[];
  specializations: string[];
  ranks: string[];
  positions: string[];
  items: EquipmentItem[];
};

export type RegulationsStore = {
  equipment: ManualRegulation[];
  medicine_base: ManualRegulation;
  medicine_rules: ManualRegulation[];
  engineer_rules: ManualRegulation[];
};

export type CompetencyItem = {
  title: string;
  group: string;
  completed: boolean;
};

export type MedalItem = {
  title: string;
  completed: boolean;
};

export type CompetenciesResponse = {
    attestations: CompetencyItem[];
    tech_access: CompetencyItem[];
    medals: MedalItem[];
    pilot_medals: MedalItem[];
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
  document_type: "page" | "link";
  url: string;
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

export type MarkdownSettings = {
  font_size: number;
  line_height: number;
  content_padding: number;
  h1_font_size: number;
  h2_font_size: number;
  h3_font_size: number;
  code_font_size: number;
  paragraph_spacing: number;
  heading_margin_top: number;
  heading_margin_bottom: number;
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
  is_docs_manager: boolean;
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
  role: "fighter" | "docs_manager" | "admin";
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
