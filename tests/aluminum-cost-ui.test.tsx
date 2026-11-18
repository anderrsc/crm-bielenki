import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AluminumCostBreakdown } from '@/components/aluminum-cost-summary';
test('o pedido mostra o preço preservado, o peso e o plano de aproveitamento',()=>{
 const html=renderToStaticMarkup(<AluminumCostBreakdown calculation={{kg:27.5,price_per_kg:10,total_cost:275,one_mm:{kg:27.5,waste_kg:0,utilization_pct:100,patterns:[{coil_width_mm:1000,coil_meters:10,kg:27.5,waste_mm:0,cuts:[{cut_mm:300,strips:1},{cut_mm:700,strips:1}]}]}}} />);
 expect(html).toContain('275,00');expect(html).toContain('27,500');expect(html).toContain('preço preservado neste pedido');expect(html).toContain('1 × 300 + 1 × 700');expect(html).toContain('Bobina 1000 mm');
});
