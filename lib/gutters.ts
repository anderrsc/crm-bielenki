export const gutterProducts=["Calha Beiral","Calha Platibanda","Calha Condutora","Calha Coletora","Rufo","Pingadeira","Chaminé","Condutor","Manutenção","PU MS40","Pintura"];
export const gutterThicknesses=["0.5 mm","0.6 mm","0.7 mm","1.0 mm"];
export const gutterCuts=[150,200,250,300,350,400,450,500,600,700,800,900,1000,1200];
export const gutterColors=["Natural","Branco","Marrom","Preto","Cinza","Personalizada"];
export type GutterPrice={id:string;product:string;thickness:string;cut_mm:number;color:string|null;unit_price:number;notes:string|null;active:boolean};
export type QuoteClient={id:string;name:string;phone?:string|null;city?:string|null};
