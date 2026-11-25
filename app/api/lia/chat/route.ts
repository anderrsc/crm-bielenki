// Redireciona para o novo endpoint da Lia Interna.
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const url = new URL("/api/lia-interna/chat", req.url);
  return NextResponse.redirect(url, { status: 308 });
}
