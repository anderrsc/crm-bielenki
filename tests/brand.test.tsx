// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {DraftQuoteAttachments} from '@/components/quote-attachments';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/app/(crm)/quote-attachment-actions',()=>({uploadQuoteAttachments:vi.fn(),downloadQuoteAttachment:vi.fn(),removeQuoteAttachment:vi.fn()}));
afterEach(()=>{cleanup();localStorage.clear()});
test('o sistema usa sempre o tema claro (sem alternância)',async()=>{
 const fs=await import('node:fs');
 const layout=fs.readFileSync('app/layout.tsx','utf8');
 expect(layout).toContain('data-theme="light"');
 expect(layout).not.toContain('marquinhos-theme');
});
test('quote file field accepts multiple internal reference documents',()=>{
 const {container}=render(<DraftQuoteAttachments/>);
 const field=container.querySelector('input[type=file]') as HTMLInputElement;
 expect(field.multiple).toBe(true);expect(field.name).toBe('quote_attachments');
 expect(field.accept).toContain('.pdf');expect(field.accept).toContain('.dwg');
 expect(screen.getByText(/não aparecem no orçamento do cliente/)).toBeTruthy();
});
