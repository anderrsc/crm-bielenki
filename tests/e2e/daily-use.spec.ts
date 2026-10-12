import { expect, test } from '@playwright/test';
import inventory from '../../scripts/route-inventory.json';
const { routes: ROUTES, errorSignatures: ERROR_SIGNATURES } = inventory;

test.beforeEach(async({page})=>{
  expect(process.env.E2E_BASE_URL,'Configure E2E_BASE_URL for an approved test environment').toBeTruthy();
  expect(process.env.E2E_EMAIL,'Configure an administrator test account').toBeTruthy();
  expect(process.env.E2E_PASSWORD,'Configure test credentials through environment secrets').toBeTruthy();
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(process.env.E2E_EMAIL!);
  await page.locator('input[name="password"]').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button',{name:'Entrar no sistema'}).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
});

for(const route of ROUTES as string[]) {
  test(`daily navigation ${route}`,async({page})=>{
    const errors: string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(route);
    expect(response?.status()).toBe(200);
    // A permission redirect or fallback screen is a failure, never a success.
    expect(new URL(page.url()).pathname).toBe(route);
    const body=await page.locator('main').innerText();
    for(const signature of ERROR_SIGNATURES as string[]) expect(body).not.toContain(signature);
    expect(body).not.toContain('Configure o Supabase para começar a operá-lo.');
    expect(errors).toEqual([]);
  });
}

test('pending filters retain category and remove no-data false positives',async({page})=>{
  await page.goto('/pendencias');
  await expect(page.getByRole('heading',{name:'Central de Pendências'})).toBeVisible();
  const finance=page.locator('a[href="/pendencias?categoria=financeiro"]');
  if(await finance.count()) {
    await finance.click();
    await expect(page).toHaveURL(/categoria=financeiro/);
    for(const href of await page.locator('main a.card').evaluateAll(es=>es.map(e=>e.getAttribute('href')))) expect(href).toMatch(/^\/financeiro/);
  }
});

test('manual sale calculation works with multiple items without saving',async({page})=>{
  await page.goto('/vendas/nova');
  await page.getByLabel('Produto / serviço').fill('Teste de cálculo');
  await page.getByLabel('Quantidade',{exact:true}).fill('2');
  await page.getByLabel('Valor unitário',{exact:true}).fill('100');
  const payload=JSON.parse(await page.locator('[name="payload"]').inputValue());
  expect(payload.items[0].quantity*payload.items[0].unit_price).toBe(200);
  await page.getByRole('button',{name:'Adicionar item'}).click();
  await expect(page.getByLabel('Produto / serviço')).toHaveCount(2);
});

test('agenda switches views and opens create dialog without saving',async({page})=>{
  await page.goto('/agenda');
  await page.getByRole('button',{name:'Dia',exact:true}).click();
  await page.getByRole('button',{name:'Semana',exact:true}).click();
  await page.getByRole('button',{name:'Mês',exact:true}).click();
  await page.getByRole('button',{name:'Novo evento',exact:true}).click();
  await expect(page.locator('input[name="title"]')).toBeVisible();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('input[name="title"]')).toHaveCount(0);
});
