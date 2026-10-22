import type { MetadataRoute } from "next"

import { SITE_URL } from "@/lib"

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/privacy", "/terms"].map((path) => ({ url: `${SITE_URL}${path}` }))
}
