'use client';
import Link from 'next/link';
import {useMobile} from '@/lib/use-mobile';
import type {AgendaSource} from '@/lib/agenda';
export function AgendaEventLink({eventId,source,children,className}:{eventId:string;source?:AgendaSource;children:React.ReactNode;className?:string}){
 const mobile=useMobile();
 return <Link href={mobile&&source?`/agenda?evento=${encodeURIComponent(eventId)}&origem=${source}`:'/agenda'} className={className}>{children}</Link>
}
