import { NextRequest, NextResponse } from "next/server";

// Delegate to Python serverless function at /api/batch.py via Vercel routing.
// In local dev, this Next.js route proxies to the Python handler.
// On Vercel, vercel.json maps /api/batch.py directly — this route is unused.

export async function POST(req: NextRequest) {
  // In dev: forward to python via vercel dev, or return a stub
  return NextResponse.json({ error: "Use vercel dev for Python routes" }, { status: 501 });
}
