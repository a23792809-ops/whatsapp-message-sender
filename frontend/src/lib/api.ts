const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data: unknown
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

function dispatchUnauthorized(endpoint: string): void {
  if (typeof window !== 'undefined' && !endpoint.startsWith('/auth/')) {
    window.dispatchEvent(new Event('bg:unauthorized'));
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        dispatchUnauthorized(endpoint);
      }
      let errData: unknown;
      try {
        errData = await res.json();
      } catch {
        errData = await res.text();
      }
      throw new ApiError(res.status, res.statusText, errData);
    }

    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new Error(
      error instanceof Error ? error.message : 'Network request failed. Is the backend server running?'
    );
  }
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  database: {
    connected: boolean;
    customers: number;
    campaigns: number;
    messages: number;
  };
}

export interface WebhookStatus {
  /** Public path to register with Meta. */
  endpoint: string;
  /** Whether WHATSAPP_WEBHOOK_VERIFY_TOKEN is set. */
  verificationConfigured: boolean;
  /** Whether WHATSAPP_APP_SECRET is set, and signatures can be checked. */
  signatureConfigured: boolean;
  /** True when a signature is mandatory: live mode or production. */
  signatureRequired: boolean;
  /** True once Meta has completed the GET handshake against this server. */
  verifiedByMeta: boolean;
}

export interface WhatsAppStatusResponse {
  mode?: string;
  configured: boolean;
  dryRun?: boolean;
  apiVersion: string;
  phoneNumberId: string;
  accessToken?: string;
  countryCode?: string;
  webhook?: WebhookStatus;
}

export interface TemplateSummary {
  id: string;
  name: string;
  body: string;
  description?: string | null;
  isActive?: boolean;
  metaName?: string | null;
  metaLanguage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplatePreviewResponse {
  template: { id: string; name: string };
  customer: { id: string; name: string; mobile: string };
  variables: string[];
  missing: string[];
  rendered: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'FAILED' | 'QUEUED' | string;
  templateId: string | null;
  throttleMs: number;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignProgressResponse {
  campaignId: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  percentage: number;
}

export interface CustomerSummary {
  id: string;
  mobile: string;
  name: string;
  status?: string;
  template?: string | null;
  variables?: string | null;
  lastAttempt?: string | null;
  createdAt?: string;
}

export interface CustomerMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  byStatus: { sent: number; failed: number; pending: number };
}

export interface PaginatedCustomers {
  data: CustomerSummary[];
  meta: CustomerMeta;
}

/** GET /messages now returns a paginated envelope. */
export interface PaginatedMessages {
  data: MessageSummary[];
  meta: PageMeta;
}

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UploadRowIssue {
  row: number;
  mobile?: string;
  reason: string;
}

export interface CustomerPreviewResponse {
  filename: string;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  existsCount: number;
  invalidCount: number;
  missingRequiredCount: number;
  invalid: UploadRowIssue[];
  duplicate: UploadRowIssue[];
  exists: UploadRowIssue[];
  sample: Array<{
    row: number;
    mobile: string;
    name: string;
    variables: Record<string, string> | null;
  }>;
}

export interface CustomerUploadResponse {
  filename: string;
  totalRows: number;
  validCount: number;
  insertedCount: number;
  invalidCount: number;
  duplicateCount: number;
  existsCount: number;
  missingRequiredCount: number;
  skippedCount: number;
  invalid: UploadRowIssue[];
  duplicate: UploadRowIssue[];
  exists: UploadRowIssue[];
}

export interface MessageSummary {
  id: string;
  customerId: string;
  campaignId: string | null;
  mobile: string;
  customerName: string;
  content: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | string;
  whatsappId: string | null;
  error: string | null;
  /** Meta's numeric code for a post-send delivery failure, when supplied. */
  errorCode: number | null;
  attemptCount: number;
  sentAt: string | null;
  /** Delivery lifecycle, filled in as the webhook reports it. */
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface SingleSendResponse {
  ok: boolean;
  mode?: string;
  messageId?: string;
  whatsappId?: string;
  status?: string;
  error?: string;
  renderedPreview?: string;
  missingVariables?: string[];
  meta?: { template?: string; language?: string; parameterCount?: number };
}

export interface WhatsAppTestRequest {
  ok: boolean;
  mode?: string;
  whatsappId?: string;
  error?: string;
  meta?: { template?: string; language?: string; parameterCount?: number };
}

/** Real token counts reported by the provider; null when it omitted usage. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiDraftResponse {
  provider: 'openai' | 'deepseek';
  model: string;
  /** The generated message text. Always a draft, never auto-sent. */
  content: string;
  /** Template placeholders present in the generated content. */
  variables: string[];
  /** null when the provider did not report usage. Never invented. */
  usage: AiUsage | null;
  /** Always true: AI output is a draft that requires human review before sending. */
  reviewRequired: boolean;
}

export interface AiSharedRequest {
  provider?: 'openai' | 'deepseek';
  instructions?: string;
  tone?: string;
  language?: string;
  businessContext?: string;
}

export interface AiGenerateRequest extends AiSharedRequest {
  template: string;
  customer: Record<string, string>;
}

export interface AiImproveRequest extends AiSharedRequest {
  message: string;
}

export interface AiPersonalizeRequest extends AiSharedRequest {
  message: string;
  customer: Record<string, string>;
}

export interface AuthUser {
  username: string;
}

export interface AuthLoginResponse {
  ok: boolean;
  user: AuthUser;
  expiresAt: string;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface AuthLogoutResponse {
  ok: boolean;
}

function authErrorMessage(data: unknown, statusText: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return statusText || 'Authentication failed.';
}

function withQuery(endpoint: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return endpoint;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `${endpoint}?${qs}` : endpoint;
}

async function uploadFile<T>(
  endpoint: string,
  file: File,
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 401) {
      dispatchUnauthorized(endpoint);
    }
    let errData: unknown;
    try {
      errData = await res.json();
    } catch {
      errData = await res.text();
    }
    throw new ApiError(res.status, res.statusText, errData);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint, { method: 'GET' }),
  post: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),

  health: {
    check: () => api.get<HealthResponse>('/health'),
  },

  whatsapp: {
    status: () => api.get<WhatsAppStatusResponse>('/whatsapp/status'),
    test: (
      to: string,
      message: string,
      template?: { name?: string; language?: string; parameters?: string[] },
    ) =>
      api.post<WhatsAppTestRequest>(
        '/whatsapp/test',
        template?.name
          ? { to, message, templateName: template.name, language: template.language, parameters: template.parameters ?? [] }
          : { to, message },
      ),
  },

  campaigns: {
    list: () => api.get<CampaignSummary[]>('/campaigns'),
    getById: (id: string) => api.get<CampaignSummary>(`/campaigns/${id}`),
    progress: (id: string) => api.get<CampaignProgressResponse>(`/campaigns/${id}/progress`),
    create: (dto: { name: string; templateId: string; customerIds: string[]; throttleMs?: number }) =>
      api.post<CampaignSummary>('/campaigns', dto),
    start: (id: string) => api.post<{ ok: boolean; status: string }>(`/campaigns/${id}/start`),
    pause: (id: string) => api.post<{ ok: boolean; status: string }>(`/campaigns/${id}/pause`),
    resume: (id: string) => api.post<{ ok: boolean; status: string }>(`/campaigns/${id}/resume`),
    stop: (id: string) => api.post<{ ok: boolean; status: string }>(`/campaigns/${id}/stop`),
    retry: (id: string) => api.post<{ ok: boolean; retried: number }>(`/campaigns/${id}/retry`),
  },

  templates: {
    list: () => api.get<TemplateSummary[]>('/templates'),
    getById: (id: string) => api.get<TemplateSummary>(`/templates/${id}`),
    create: (dto: { name: string; body: string; description?: string }) =>
      api.post<TemplateSummary>('/templates', dto),
    update: (id: string, dto: { name?: string; body?: string; description?: string; isActive?: boolean }) =>
      api.patch<TemplateSummary>(`/templates/${id}`, dto),
    archive: (id: string) => api.delete<TemplateSummary>(`/templates/${id}`),
    preview: (id: string, customerId: string) =>
      api.post<TemplatePreviewResponse>(`/templates/${id}/preview`, { customerId }),
  },

  messages: {
    /** Paginated envelope, for callers that want server-side paging. */
    listPaged: (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      campaignId?: string;
      customerId?: string;
    }) => api.get<PaginatedMessages>(withQuery('/messages', params)),
    /** Flat array of the current page, preserving the previous call shape. */
    list: async () => (await api.get<PaginatedMessages>('/messages')).data,
    send: (customerId: string, templateId: string) =>
      api.post<SingleSendResponse>('/messages/send', { customerId, templateId }),
  },

  customers: {
    list: (params?: { search?: string; status?: string; page?: number; pageSize?: number }) =>
      api.get<PaginatedCustomers>(withQuery('/customers', params)),
    preview: (file: File) => uploadFile<CustomerPreviewResponse>('/customers/upload/preview', file),
    upload: (file: File) => uploadFile<CustomerUploadResponse>('/customers/upload', file),
  },

  ai: {
    generate: (dto: AiGenerateRequest) => api.post<AiDraftResponse>('/ai/generate', dto),
    improve: (dto: AiImproveRequest) => api.post<AiDraftResponse>('/ai/improve', dto),
    personalize: (dto: AiPersonalizeRequest) => api.post<AiDraftResponse>('/ai/personalize', dto),
  },

  auth: {
    login: async (username: string, password: string): Promise<AuthLoginResponse> => {
      try {
        return await api.post<AuthLoginResponse>('/auth/login', { username, password });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Error('Invalid username or password.');
        }
        throw error;
      }
    },
    me: () => api.get<AuthMeResponse>('/auth/me'),
    logout: () => api.post<AuthLogoutResponse>('/auth/logout'),
  },
};

export { authErrorMessage };
