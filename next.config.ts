import type { NextConfig } from "next";

// 호스트 이름만 비교하므로 포트(:3000)를 붙이면 매칭되지 않음
const allowedDevOrigins = [
  'localhost',
  '127.0.0.1',
  '192.168.0.41',   // LAN IP
  '100.110.151.44', // Tailscale IP
  'ubuntu',         // MagicDNS 호스트명
];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  images: {
    // Next 16: 로컬 이미지에 쿼리스트링(?v=2 등)을 쓰려면 등록 필요. search 생략 = 모든 쿼리 허용
    localPatterns: [{ pathname: '/assets/**' }],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    // Don't optimize external favicon URLs
    unoptimized: process.env.NODE_ENV === 'development',
  },
  // Suppress favicon fetch errors in development
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: 'https://finance.valyu.ai',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
