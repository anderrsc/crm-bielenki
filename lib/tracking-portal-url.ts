export const TRACKCEO_PORTAL_URL='https://gps.trackceo.com/V2/index.jsp';
// O portal fictício só é usado no ambiente E2E local, nunca por URL recebida do usuário.
export function trackingPortalUrl(){
 return process.env.CRM_E2E_TEST_MODE==='1'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='http://localhost:54321'
  &&process.env.TRACKCEO_TEST_API_ORIGIN==='http://127.0.0.1:54323'?'http://127.0.0.1:54323/portal':TRACKCEO_PORTAL_URL;
}
