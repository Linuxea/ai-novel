import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  title: "墨章 · AI 小说生成器",
  description: "与 AI 协作构建你的小说世界：世界观、人物、剧情与角色关系图谱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        {/* xyflow 样式以静态资源加载，避免 lightningcss 在部分环境崩溃 */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/xyflow.css" />
      </head>
      <body className="min-h-full flex flex-col bg-background">
        <AppProviders>
          <TooltipProvider>
            {children}
            <Toaster richColors position="top-center" />
          </TooltipProvider>
        </AppProviders>
      </body>
    </html>
  );
}
