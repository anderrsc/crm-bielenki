export const gutterProducts=["Calha Platibanda","Calha de Beiral","Calha Condutora","Calha Coletora","Rufo","Rufo com Pingadeira","Rufo de Acabamento","Rufo Água Furtada","Rufo de Cumeeira","Rufo Sobre Calha","Pingadeira","Pingadeira com Rufo","Pingadeira de Marquise","Chaminé","Condutor","PU MS40","Pintura"];
export const gutterThicknesses=["0.5mm","0.6mm","0.7mm","1.0mm"];
export const gutterCuts=[150,200,250,300,350,400,450,500,600,700,800,900,1000,1200];
export const gutterColors=["Natural","Branco","Marrom","Preto","Cinza","Personalizada"];
export type GutterPrice={id:string;product:string;thickness:string;cut_mm:number;color:string|null;unit_price:number;notes:string|null;active:boolean};
export type QuoteClient={id:string;name:string;phone?:string|null;city?:string|null};
