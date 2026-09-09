import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://pictorium.example.com"
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/status`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.5 },
  ]
}
