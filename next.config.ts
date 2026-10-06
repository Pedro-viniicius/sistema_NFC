import type { NextConfig } from "next";

const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // As artes de impressão são lidas do disco em tempo de execução (somente leitura):
  // precisam ser empacotadas junto com as funções do painel na Vercel.
  outputFileTracingIncludes: {
    "/admin/**": ["./templates/*.pdf"],
  },
  experimental: {
    serverActions: {
      // O envio da arte de impressão (PDF de até 2 MB) passa por uma Server Action; o padrão é 1 MB.
      bodySizeLimit: "3mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
};

export default nextConfig;
