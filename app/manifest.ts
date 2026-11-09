import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest {
 return { name:'CRM Bielenki',short_name:'CRM Bielenki',start_url:'/dashboard',display:'standalone',background_color:'#111111',theme_color:'#234d3c',icons:[{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}] };
}
