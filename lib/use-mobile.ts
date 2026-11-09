'use client';
import { useSyncExternalStore } from 'react';
const query='(max-width: 767px)';
function subscribe(callback:()=>void){if(typeof window.matchMedia!=='function')return()=>{};const media=window.matchMedia(query);media.addEventListener('change',callback);return()=>media.removeEventListener('change',callback)}
export function useMobile(){return useSyncExternalStore(subscribe,()=>typeof window.matchMedia==='function'&&window.matchMedia(query).matches,()=>false)}
