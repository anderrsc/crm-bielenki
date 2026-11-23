// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('@/app/(crm)/actions',()=>({createWindowQuote:vi.fn()}));
vi.mock('@/components/quote-attachments',()=>({DraftQuoteAttachments:()=>null}));
vi.mock('@/components/client-select',()=>({ClientSelect:()=>null}));
vi.mock('@/components/wvetro-import',()=>({WvetroImport:({onRead}:any)=><button type="button" onClick={()=>onRead({items:[{product:'Janela',line:'Suprema',measurements:'1200 × 1000',glass:'',accessories:'',color:'Branco',quantity:3,unit_price:0}],notes:'Referente à proposta nº 1768.',proposal:{numero:'1768',total:500},metragens:[3.6],via:'texto',file:new File(['pdf'],'proposta.pdf')})}>Importar proposta</button>}));
import { WindowQuote } from '@/components/window-quote';
test('importar sempre oculta valores individuais, antes de repartir o total',async()=>{
  const view=render(<WindowQuote clients={[]}/>);
  try {
    fireEvent.click(view.getByText('Importar proposta'));
    await waitFor(()=>expect(JSON.parse((view.container.querySelector('input[name="payload"]') as HTMLInputElement).value).hide_unit_prices).toBe(true));
    const checkbox=view.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(JSON.parse((view.container.querySelector('input[name="payload"]') as HTMLInputElement).value).items[0].measurements).toBe('1200 × 1000');
  } finally {cleanup();}
});
