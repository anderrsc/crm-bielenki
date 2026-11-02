// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ThemeToggle} from '@/components/theme-toggle';
import {DraftQuoteAttachments} from '@/components/quote-attachments';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/app/(crm)/quote-attachment-actions',()=>({uploadQuoteAttachments:vi.fn(),downloadQuoteAttachment:vi.fn(),removeQuoteAttachment:vi.fn()}));
afterEach(()=>{cleanup();localStorage.clear()});
test('theme changes and persists the current choice',()=>{
 document.documentElement.dataset.theme='dark';render(<ThemeToggle/>);
 fireEvent.click(screen.getByRole('button',{name:'Ativar tema claro'}));
 expect(document.documentElement.dataset.theme).toBe('light');
 expect(localStorage.getItem('marquinhos-theme')).toBe('light');
 fireEvent.click(screen.getByRole('button',{name:'Ativar tema escuro'}));
 expect(localStorage.getItem('marquinhos-theme')).toBe('dark');
});
test('quote file field accepts multiple internal reference documents',()=>{
 const {container}=render(<DraftQuoteAttachments/>);
 const field=container.querySelector('input[type=file]') as HTMLInputElement;
 expect(field.multiple).toBe(true);expect(field.name).toBe('quote_attachments');
 expect(field.accept).toContain('.pdf');expect(field.accept).toContain('.dwg');
 expect(screen.getByText(/não aparecem no orçamento do cliente/)).toBeTruthy();
});
