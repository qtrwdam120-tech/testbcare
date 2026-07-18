/**
 * DashboardPage - إعادة كتابة نظيفة
 * يعرض كل عميل في تبويب واحد فقط بناءً على رقم الهوية أو رقم الهاتف
 */

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { addData } from "@/lib/api";

// ─────────────────────────────────────────────
// الأنواع (Types)
// ─────────────────────────────────────────────

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

// عميل مدمج - يمثل كل السجلات لنفس الشخص الحقيقي
type MergedCustomer = {
  // معرف العميل الفريد
  customerKey: string;
  
  // البيانات الأساسية
  id: string; // آخر معرف
  visitorId: string; // آخر visitorId
  
  // اسم العميل للعرض
  displayName: string;
  
  // الحالة والخطوة
  status: string;
  stage: string;
  badge: string;
  
  // الأوقات
  submittedAt: string;
  updatedAt: string;
  
  // البيانات المدمجة من كل السجلات
  mergedData: Record<string, any>;
  
  // عدد السجلات المدمجة
  entriesCount: number;
  
  // أول سجل (الأقدم)
  firstEntry: RequestItem;
  // آخر سجل (الأحدث)
  lastEntry: RequestItem;
  
  // هل متصل الآن
  isOnline: boolean;
  
  // الصفحة الحالية
  currentPage: string;
};

const DASHBOARD_BACKEND_URL = import.meta.env.VITE_BACKEND_TARGET || "http://127.0.0.1:3002";

// ─────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────

function normalizeValue(value?: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return String(value).trim().toLowerCase();
}

function getCustomerIdentity(request: RequestItem): { identity?: string; phone?: string; visitorId?: string } {
  const raw = request.raw || {};
  
  // رقم الهوية (الأولوية الأولى)
  const identity = normalizeValue(
    raw.identityNumber || 
    raw.phoneIdNumber || 
    raw.nafadIdNumber
  );
  
  // رقم الهاتف (الثاني)
  const phone = normalizeValue(
    raw.phoneNumber || 
    raw.mobileNumber
  );
  
  // معرف الزائر (الثالث)
  const visitorId = normalizeValue(request.visitorId);
  
  return { identity, phone, visitorId };
}

function getUniqueCustomerKey(request: RequestItem): string {
  const { identity, phone, visitorId } = getCustomerIdentity(request);
  
  // الأولوية: identityNumber > phoneNumber > visitorId
  if (identity) return `id:${identity}`;
  if (phone) return `phone:${phone}`;
  if (visitorId) return `vid:${visitorId}`;
  
  // أخير: استخدم الـ id
  return `req:${request.id}`;
}

function getDisplayName(request: RequestItem): string {
  const raw = request.raw || {};
  
  // الأولوية: ownerName > name > identityNumber > phoneNumber > visitorId > "زائر"
  const name = raw.ownerName || raw.name || raw.customer || request.customer;
  if (name && name !== 'زائر') {
    return String(name);
  }
  
  const identity = raw.identityNumber || raw.phoneIdNumber || raw.nafadIdNumber;
  if (identity) return String(identity);
  
  const phone = raw.phoneNumber || raw.mobileNumber;
  if (phone) return String(phone);
  
  return 'زائر';
}

function formatElapsedTime(isoString?: string): string {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return "الآن";
  
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function mergeRequestData(existing: Record<string, any>, newData: Record<string, any>): Record<string, any> {
  // دمج البيانات - البيانات الأحدث تأخذ الأولوية
  return {
    ...existing,
    ...newData,
    // لكن نحافظ على بعض البيانات القديمة المهمة
    createdAt: existing.createdAt || newData.createdAt,
  };
}

// ─────────────────────────────────────────────
// المكون الرئيسي
// ─────────────────────────────────────────────

export default function DashboardPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "cards" | "pending">("all");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  // ─────────────────────────────────────────────
  // استقبال البيانات من السيرفر
  // ─────────────────────────────────────────────

  useEffect(() => {
    // جلب البيانات الأولية
    async function loadData() {
      try {
        const response = await fetch("/api/dashboard/requests");
        if (response.ok) {
          const data = await response.json();
          setRequests(data);
        }
      } catch (error) {
        console.error("[Dashboard] Failed to load requests:", error);
      }
    }

    loadData();

    // الاتصال بالـ Socket لل تحديثات مباشرة
    const socket = io(DASHBOARD_BACKEND_URL, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[Dashboard] Socket connected:", socket.id);
    });

    socket.on("dashboard:init", (data: RequestItem[]) => {
      console.log("[Dashboard] Initial data:", data.length);
      setRequests(data);
    });

    socket.on("dashboard:update", (updated: RequestItem) => {
      setRequests(prev => {
        // إذا كان السجل موجود، حدثه
        const exists = prev.some(r => r.id === updated.id);
        if (exists) {
          return prev.map(r => r.id === updated.id ? updated : r);
        }
        // إذا كان جديد، أضفه
        return [updated, ...prev];
      });
    });

    socket.on("dashboard:delete", ({ id }: { id: string }) => {
      setRequests(prev => prev.filter(r => r.id !== id));
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // تحديث الوقت كل دقيقة
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ─────────────────────────────────────────────
  // تجميع العملاء (Deduplication)
  // ─────────────────────────────────────────────

  const mergedCustomers = useMemo((): MergedCustomer[] => {
    // خريطة لتجميع السجلات حسب العميل
    const customerMap = new Map<string, {
      entries: RequestItem[];
      mergedData: Record<string, any>;
    }>();

    // تجميع كل السجلات حسب مفتاح العميل
    requests.forEach(request => {
      const key = getUniqueCustomerKey(request);
      
      if (!customerMap.has(key)) {
        customerMap.set(key, {
          entries: [],
          mergedData: {},
        });
      }
      
      const customer = customerMap.get(key)!;
      customer.entries.push(request);
      customer.mergedData = mergeRequestData(customer.mergedData, request.raw || {});
    });

    // تحويل الخريطة إلى مصفوفة عملاء مدمجين
    const customers: MergedCustomer[] = [];

    customerMap.forEach((data, key) => {
      const entries = data.entries;
      const mergedData = data.mergedData;

      // ترتيب السجلات حسب الوقت (الأحدث أولاً)
      entries.sort((a, b) => {
        const timeA = new Date(a.submittedAt || a.updatedAt || 0).getTime();
        const timeB = new Date(b.submittedAt || b.updatedAt || 0).getTime();
        return timeB - timeA;
      });

      const lastEntry = entries[0]; // الأحدث
      const firstEntry = entries[entries.length - 1]; // الأقدم

      // تحديد الحالة والخطوة من آخر سجل
      let status = lastEntry.status;
      let stage = lastEntry.stage;
      let badge = lastEntry.badge || "";

      // إذا كان هناك سجل بمعلومات أحدث في mergedData
      if (mergedData.currentPage) {
        if (mergedData.currentPage === 'insur' || mergedData.currentPage === 'confi') {
          status = "قيد المعالجة";
          stage = "الخطوة 2";
          badge = "pending";
        } else if (mergedData.currentPage === 'nafad' || mergedData.currentPage === 'phone' || mergedData.currentPage === 'thank-you') {
          status = "مكتمل";
          stage = "الخطوة 3";
          badge = "";
        }
      }

      customers.push({
        customerKey: key,
        id: lastEntry.id,
        visitorId: lastEntry.visitorId || lastEntry.id,
        displayName: getDisplayName(lastEntry),
        status,
        stage,
        badge,
        submittedAt: firstEntry.submittedAt || firstEntry.updatedAt || "",
        updatedAt: lastEntry.submittedAt || lastEntry.updatedAt || "",
        mergedData,
        entriesCount: entries.length,
        firstEntry,
        lastEntry,
        isOnline: Boolean(mergedData.isOnline),
        currentPage: mergedData.currentPage || lastEntry.raw?.currentPage || 'home',
      });
    });

    // ترتيب العملاء حسب آخر تحديث (الأحدث أولاً)
    customers.sort((a, b) => {
      const timeA = new Date(a.updatedAt || 0).getTime();
      const timeB = new Date(b.updatedAt || 0).getTime();
      return timeB - timeA;
    });

    return customers;
  }, [requests]);

  // ─────────────────────────────────────────────
  // تصفية العملاء
  // ─────────────────────────────────────────────

  const filteredCustomers = useMemo(() => {
    let filtered = mergedCustomers;

    // تصفية حسب البحث
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.displayName.toLowerCase().includes(query) ||
        c.visitorId.toLowerCase().includes(query) ||
        c.mergedData.identityNumber?.toLowerCase().includes(query) ||
        c.mergedData.phoneNumber?.toLowerCase().includes(query)
      );
    }

    // تصفية حسب النوع
    if (filterMode === "cards") {
      filtered = filtered.filter(c => 
        c.mergedData.cardNumber || 
        c.mergedData._v1 || 
        c.mergedData.hasCard
      );
    } else if (filterMode === "pending") {
      filtered = filtered.filter(c => c.badge === "pending");
    }

    return filtered;
  }, [mergedCustomers, searchQuery, filterMode]);

  // ─────────────────────────────────────────────
  // الإحصائيات
  // ─────────────────────────────────────────────

  const stats = useMemo(() => ({
    total: mergedCustomers.length,
    new: mergedCustomers.filter(c => c.badge === "new").length,
    pending: mergedCustomers.filter(c => c.badge === "pending").length,
    completed: mergedCustomers.filter(c => !c.badge).length,
    hasCard: mergedCustomers.filter(c => c.mergedData.cardNumber || c.mergedData._v1).length,
  }), [mergedCustomers]);

  // ─────────────────────────────────────────────
  // العميل المحدد
  // ─────────────────────────────────────────────

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerKey) return null;
    return mergedCustomers.find(c => c.customerKey === selectedCustomerKey) || null;
  }, [selectedCustomerKey, mergedCustomers]);

  // ─────────────────────────────────────────────
  // العرض
  // ─────────────────────────────────────────────

  return (
    <div style={{ 
      fontFamily: "Cairo, Tajawal, sans-serif", 
      minHeight: "100vh", 
      background: "#f9fafb",
      direction: "rtl"
    }}>
      {/* Header */}
      <div style={{
        background: "white",
        borderBottom: "1px solid #e5e7eb",
        padding: "16px 24px",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1400, margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "#111827" }}>
            لوحة التحكم
          </h1>
          
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ 
              padding: "6px 12px", 
              background: "#f3f4f6", 
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
            }}>
              الكل ({stats.total})
            </span>
            <span style={{ 
              padding: "6px 12px", 
              background: stats.new > 0 ? "#dbeafe" : "#f3f4f6", 
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: stats.new > 0 ? "#1d4ed8" : "#6b7280",
            }}>
              جديد ({stats.new})
            </span>
            <span style={{ 
              padding: "6px 12px", 
              background: stats.pending > 0 ? "#fef3c7" : "#f3f4f6", 
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: stats.pending > 0 ? "#d97706" : "#6b7280",
            }}>
              قيد ({stats.pending})
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", maxWidth: 1400, margin: "0 auto", minHeight: "calc(100vh - 65px)" }}>
        {/* Sidebar - قائمة العملاء */}
        <div style={{
          width: 320,
          borderLeft: "1px solid #e5e7eb",
          background: "white",
          overflowY: "auto",
          maxHeight: "calc(100vh - 65px)",
        }}>
          {/* البحث */}
          <div style={{ padding: 16, borderBottom: "1px solid #e5e7eb" }}>
            <input
              type="text"
              placeholder="بحث (الاسم، الهوية، الهاتف)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: "0.9rem",
                outline: "none",
              }}
            />
          </div>

          {/* الفلاتر */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", gap: 8 }}>
            {(["all", "cards", "pending"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: filterMode === mode ? "#16a34a" : "#f3f4f6",
                  color: filterMode === mode ? "white" : "#6b7280",
                }}
              >
                {mode === "all" ? "الكل" : mode === "cards" ? "بطاقات" : "قيد"}
              </button>
            ))}
          </div>

          {/* قائمة العملاء */}
          <div>
            {filteredCustomers.map(customer => (
              <div
                key={customer.customerKey}
                onClick={() => setSelectedCustomerKey(customer.customerKey)}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #f3f4f6",
                  cursor: "pointer",
                  background: selectedCustomerKey === customer.customerKey ? "#f0fdf4" : "white",
                  borderRight: selectedCustomerKey === customer.customerKey ? "3px solid #16a34a" : "3px solid transparent",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* الأفاتار */}
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: customer.isOnline 
                      ? "linear-gradient(135deg, #16a34a, #15803d)" 
                      : "#9ca3af",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    flexShrink: 0,
                  }}>
                    {customer.displayName.charAt(0).toUpperCase()}
                  </div>

                  {/* المعلومات */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ 
                        fontWeight: 700, 
                        fontSize: "0.9rem",
                        color: selectedCustomerKey === customer.customerKey ? "#15803d" : "#111827",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 140,
                      }}>
                        {customer.displayName}
                      </span>
                      <span style={{ 
                        fontSize: "0.7rem", 
                        color: customer.isOnline ? "#16a34a" : "#9ca3af",
                        fontWeight: 600,
                      }}>
                        {formatElapsedTime(customer.updatedAt)}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                        {customer.currentPage}
                      </span>
                      {customer.entriesCount > 1 && (
                        <span style={{ 
                          fontSize: "0.7rem", 
                          background: "#e5e7eb",
                          padding: "2px 6px",
                          borderRadius: 4,
                          color: "#6b7280",
                        }}>
                          {customer.entriesCount}سجل
                        </span>
                      )}
                      <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: customer.isOnline ? "#16a34a" : "#9ca3af",
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {filteredCustomers.length === 0 && (
              <div style={{ 
                padding: 40, 
                textAlign: "center", 
                color: "#9ca3af" 
              }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
                <div>لا يوجد عملاء</div>
              </div>
            )}
          </div>
        </div>

        {/* المحتوى الرئيسي - تفاصيل العميل */}
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {selectedCustomer ? (
            <div>
              {/* Header */}
              <div style={{ 
                background: "white", 
                borderRadius: 12, 
                padding: 20, 
                marginBottom: 16,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{
                    width: 60,
                    height: 60,
                    borderRadius: "50%",
                    background: selectedCustomer.isOnline 
                      ? "linear-gradient(135deg, #16a34a, #15803d)" 
                      : "#9ca3af",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontWeight: 700,
                    fontSize: "1.5rem",
                  }}>
                    {selectedCustomer.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#111827" }}>
                      {selectedCustomer.displayName}
                    </h2>
                    <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                      <span style={{ 
                        fontSize: "0.85rem", 
                        color: "#6b7280",
                      }}>
                        {selectedCustomer.stage}
                      </span>
                      <span style={{ 
                        fontSize: "0.85rem", 
                        color: selectedCustomer.isOnline ? "#16a34a" : "#9ca3af",
                      }}>
                        {selectedCustomer.isOnline ? "متصل" : "غير متصل"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* البيانات المدمجة */}
              <div style={{ 
                background: "white", 
                borderRadius: 12, 
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}>
                <h3 style={{ margin: "0 0 16px", fontSize: "1rem", color: "#374151" }}>
                  البيانات المجمعة ({selectedCustomer.entriesCount} سجل)
                </h3>
                
                <div style={{ display: "grid", gap: 12 }}>
                  {Object.entries(selectedCustomer.mergedData)
                    .filter(([key]) => !['updatedAt', 'createdAt', 'history', '__proto__'].includes(key))
                    .slice(0, 30) // عرض أول 30 حقل
                    .map(([key, value]) => (
                      <div 
                        key={key}
                        style={{ 
                          display: "flex", 
                          borderBottom: "1px solid #f3f4f6",
                          paddingBottom: 8,
                        }}
                      >
                        <span style={{ 
                          fontWeight: 600, 
                          color: "#374151",
                          minWidth: 120,
                          fontSize: "0.85rem",
                        }}>
                          {key}
                        </span>
                        <span style={{ 
                          color: "#6b7280",
                          fontSize: "0.85rem",
                          wordBreak: "break-all",
                        }}>
                          {String(value ?? '—')}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ 
              display: "flex", 
              flexDirection: "column",
              alignItems: "center", 
              justifyContent: "center",
              height: "100%",
              color: "#9ca3af",
            }}>
              <div style={{ fontSize: "4rem", marginBottom: 16 }}>👈</div>
              <div style={{ fontSize: "1.1rem" }}>اختر عميلاً لعرض التفاصيل</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
