/** @type {import('next').NextConfig} */
const nextConfig={
  reactStrictMode:true,
  output:'standalone',
  poweredByHeader:false,
  compress:true,
  experimental:{
    instrumentationHook:true,
    serverActions:{bodySizeLimit:'50mb'},
    optimizePackageImports:['lucide-react'],
  },
};
export default nextConfig;
